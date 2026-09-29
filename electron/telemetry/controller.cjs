const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter, once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { normalizeTelemetryEvent } = require('./event-normalizer.cjs');

class TelemetryController extends EventEmitter {
  constructor({ app, logger, taskRegistry }) {
    super();
    this.app = app;
    this.logger = logger;
    this.taskRegistry = taskRegistry;

    this.child = null;
    this.stream = null;
    this.buffer = '';
    this.statusTimer = null;
    this.taskId = null;
    this.sessionDir = null;
    this.lastSessionDir = null;
    this.stopRequested = false;

    this.state = this.#emptyState();
  }

  getStatus() {
    return {
      ...this.state,
      supported: process.platform === 'win32',
      helperAvailable: fs.existsSync(this.#helperPath())
    };
  }

  async start(options = {}) {
    if (process.platform !== 'win32') {
      throw new Error('Input TelemetryはWindows版VReviewでのみ利用できます。');
    }
    if (this.child) return this.getStatus();

    const helper = this.#helperPath();
    if (!fs.existsSync(helper)) {
      throw new Error('Input Telemetry Helperが見つかりません。VReviewを最新版へ更新してください。');
    }

    const sessionId = randomUUID();
    const folderName = `session-${timestampForPath()}-${sessionId.slice(0, 8)}`;
    const baseDirectory = resolveBaseDirectory(options?.baseDirectory, this.app.getPath('userData'));
    fs.mkdirSync(baseDirectory, { recursive: true });
    const sessionDir = path.join(baseDirectory, folderName);
    fs.mkdirSync(sessionDir, { recursive: false });

    const eventsPath = path.join(sessionDir, 'telemetry.ndjson');
    const stream = fs.createWriteStream(eventsPath, { flags: 'wx', encoding: 'utf8' });

    this.sessionDir = sessionDir;
    this.lastSessionDir = sessionDir;
    this.stream = stream;
    this.buffer = '';
    this.stopRequested = false;
    this.state = {
      phase: 'starting',
      active: true,
      sessionId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      helperVersion: null,
      qpcFrequency: null,
      valorantForeground: false,
            inputEvents: 0,
      mouseSamples: 0,
      buttonEvents: 0,
      keyEvents: 0,
      invalidEvents: 0,
      lastError: null
    };

    const task = this.taskRegistry?.create({ type: 'input-telemetry' });
    this.taskId = task?.id || null;
    if (this.taskId) this.taskRegistry.update(this.taskId, { state: 'running', message: 'Input Telemetryを記録中' });

    this.#writeManifest('recording');

    const child = spawn(helper, [], {
      cwd: path.dirname(helper),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.#handleStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      this.logger?.warn('telemetry.helper.stderr', { message: String(chunk).trim().slice(0, 240) });
    });
    child.on('error', error => {
      this.logger?.error('telemetry.helper.error', { message: error.message });
      this.state.lastError = String(error.message || error).slice(0, 180);
      this.#finalize('failed');
    });
    child.on('exit', (code, signal) => {
      const failed = !this.stopRequested && Number(code || 0) !== 0;
      if (failed) {
        this.state.lastError = `Helper exited with code ${String(code)}`;
        this.logger?.error('telemetry.helper.exit', { code, signal: signal || '' });
      }
      this.#finalize(failed ? 'failed' : 'completed');
    });

    this.logger?.info('telemetry.start', { sessionId });
    this.#emitStatus(true);
    return this.getStatus();
  }

  async stop() {
    const child = this.child;
    if (!child) return this.getStatus();

    this.stopRequested = true;
    this.state.phase = 'stopping';
    this.#emitStatus(true);

    try {
      child.stdin?.write('quit\n');
    } catch {
      // Fallback below terminates the helper.
    }

    const graceful = once(child, 'exit').catch(() => null);
    const timeout = delay(1500).then(() => 'timeout');
    const result = await Promise.race([graceful, timeout]);
    if (result === 'timeout' && this.child === child) {
      child.kill();
      await Promise.race([once(child, 'exit').catch(() => null), delay(700)]);
    }

    if (this.child === child) this.#finalize('completed');
    return this.getStatus();
  }

  getSessionDirectory() {
    return this.sessionDir || this.lastSessionDir || null;
  }

  async shutdown() {
    if (!this.child) return;
    try {
      await this.stop();
    } catch (error) {
      this.logger?.warn('telemetry.shutdown.failed', { message: error.message });
      this.child?.kill();
      this.#finalize('interrupted');
    }
  }

  #handleStdout(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        this.state.invalidEvents++;
        continue;
      }

      const event = normalizeTelemetryEvent(parsed);
      if (!event) {
        this.state.invalidEvents++;
        continue;
      }

      this.stream?.write(`${JSON.stringify(event)}\n`);

      if (event.type === 'ready') {
        this.state.phase = 'recording';
        this.state.helperVersion = event.helperVersion || null;
        this.state.qpcFrequency = event.qpcFrequency || null;
        this.#writeManifest('recording');
        this.#emitStatus(true);
        continue;
      }

      if (event.type === 'focus') {
        this.state.valorantForeground = event.valorant;
        this.#emitStatus(true);
        continue;
      }

      if (event.type === 'mouse') {
        this.state.mouseSamples++;
        this.state.inputEvents++;
      } else if (event.type === 'button') {
        this.state.buttonEvents++;
        this.state.inputEvents++;
      } else if (event.type === 'key') {
        this.state.keyEvents++;
        this.state.inputEvents++;
      }

      this.#emitStatus(false);
    }
  }

  #emitStatus(immediate) {
    if (immediate) {
      if (this.statusTimer) {
        clearTimeout(this.statusTimer);
        this.statusTimer = null;
      }
      this.emit('status', this.getStatus());
      return;
    }
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      this.emit('status', this.getStatus());
    }, 250);
  }

  #finalize(outcome) {
    if (!this.child && !this.stream && !this.state.active) return;

    const child = this.child;
    this.child = null;
    this.stopRequested = false;

    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }

    if (this.stream) {
      try { this.stream.end(); } catch {}
      this.stream = null;
    }

    this.state.active = false;
    this.state.phase = outcome === 'failed' ? 'failed' : outcome === 'interrupted' ? 'interrupted' : 'stopped';
    this.state.endedAt = new Date().toISOString();
    this.state.valorantForeground = false;

    if (this.taskId) {
      this.taskRegistry?.update(this.taskId, {
        state: outcome === 'failed' ? 'failed' : outcome === 'interrupted' ? 'interrupted' : 'completed',
        progress: 1,
        message: outcome === 'failed' ? 'Input Telemetry Helperが異常終了しました。' : 'Input Telemetryを保存しました。'
      });
      this.taskId = null;
    }

    this.#writeManifest(outcome);
    this.logger?.info('telemetry.stop', {
      sessionId: this.state.sessionId || '',
      outcome,
      inputEvents: this.state.inputEvents
    });

    if (child) {
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
    }

    this.sessionDir = null;
    this.emit('status', this.getStatus());
  }

  #writeManifest(outcome) {
    const dir = this.sessionDir || this.lastSessionDir;
    if (!dir) return;

    const manifest = {
      schema: 'vreview-input-telemetry-session',
      schemaVersion: 1,
      sessionId: this.state.sessionId,
      startedAt: this.state.startedAt,
      endedAt: this.state.endedAt,
      outcome,
      helperVersion: this.state.helperVersion,
      qpcFrequency: this.state.qpcFrequency,
      capturePolicy: {
        explicitStartStop: true,
        valorantForegroundOnly: true,
        processInjection: false,
        processMemoryRead: false,
        inputAutomation: false,
        allowedMouse: ['dx', 'dy', 'LMB'],
        allowedKeys: ['W', 'A', 'S', 'D'],
        clipboard: false,
        textInput: false
      },
      eventFile: 'telemetry.ndjson',
      stats: {
        inputEvents: this.state.inputEvents,
        mouseSamples: this.state.mouseSamples,
        buttonEvents: this.state.buttonEvents,
        keyEvents: this.state.keyEvents,
        invalidEvents: this.state.invalidEvents
      }
    };

    const file = path.join(dir, 'telemetry-session.json');
    const temp = `${file}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(manifest, null, 2), 'utf8');
      fs.renameSync(temp, file);
    } catch (error) {
      this.logger?.warn('telemetry.manifest.failed', { message: error.message });
    }
  }

  #helperPath() {
    if (this.app.isPackaged) {
      return path.join(process.resourcesPath, 'input-helper', 'vreview-input-telemetry.exe');
    }
    return path.join(this.app.getAppPath(), 'native', 'bin', 'vreview-input-telemetry.exe');
  }

  #emptyState() {
    return {
      phase: 'inactive',
      active: false,
      sessionId: null,
      startedAt: null,
      endedAt: null,
      helperVersion: null,
      qpcFrequency: null,
      valorantForeground: false,
            inputEvents: 0,
      mouseSamples: 0,
      buttonEvents: 0,
      keyEvents: 0,
      invalidEvents: 0,
      lastError: null
    };
  }
}

function resolveBaseDirectory(value, userDataPath) {
  const directory = String(value || '').trim();
  return directory || path.join(userDataPath, 'sessions');
}

function timestampForPath() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, 'Z');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { TelemetryController };
