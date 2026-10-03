const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { COLLECTOR_VERSION } = require('./core.cjs');

class TrackerSessionStore {
  constructor({ rootDirectory, logger }) {
    this.rootDirectory = rootDirectory;
    this.logger = logger;
    this.sessionDir = null;
    this.manifest = null;
  }

  create({ mode, browser, windowInfo, settings }) {
    const now = new Date();
    const sessionId = randomUUID();
    const date = now.toISOString().slice(0, 10);
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, 'Z');
    const sessionDir = path.join(this.rootDirectory, date, `session-${stamp}-${sessionId.slice(0, 8)}`);
    fs.mkdirSync(path.join(sessionDir, 'captures'), { recursive: true });

    this.sessionDir = sessionDir;
    this.manifest = {
      schema: 'vreview-tracker-capture-session',
      schemaVersion: 1,
      collectorVersion: COLLECTOR_VERSION,
      sessionId,
      startedAt: now.toISOString(),
      finishedAt: null,
      status: 'running',
      stopReason: null,
      source: 'tracker.gg',
      captureMode: mode,
      browser: browser || 'chrome',
      window: {
        title: String(windowInfo?.title || '').slice(0, 240),
        bounds: windowInfo?.bounds || null,
        sourceIdStored: false,
        nativeWindowIdStored: false
      },
      settings: {
        captureFormat: settings.captureFormat,
        scrollStepRatio: settings.scrollStepRatio,
        stableWaitMs: settings.stableWaitMs,
        maxCaptures: settings.maxCaptures
      },
      captures: [],
      tabs: {},
      errors: []
    };

    this.#writeReadme();
    this.writeManifest();
    return { sessionId, sessionDir };
  }

  getSessionDirectory() {
    return this.sessionDir;
  }

  getManifest() {
    return this.manifest ? structuredClone(this.manifest) : null;
  }

  captureDirectory(group) {
    if (!this.sessionDir) throw new Error('Tracker session is not active.');
    const safe = String(group || '').toLowerCase();
    if (!/^[a-z0-9-]{1,48}$/.test(safe)) throw new Error('Invalid capture group.');
    const dir = path.join(this.sessionDir, 'captures', safe);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  addCapture({ group, fileName, width, height, capturedAt, stable, diff }) {
    if (!this.manifest) throw new Error('Tracker manifest is not active.');
    const relativePath = path.posix.join('captures', group, fileName);
    const item = {
      index: this.manifest.captures.length + 1,
      group,
      path: relativePath,
      capturedAt: capturedAt || new Date().toISOString(),
      width,
      height,
      stable: stable !== false,
      differenceFromPrevious: Number.isFinite(diff) ? Number(diff.toFixed(6)) : null
    };
    this.manifest.captures.push(item);

    if (group !== 'match-history') {
      const tab = this.manifest.tabs[group] || { captures: [], status: 'running' };
      tab.captures.push(relativePath);
      this.manifest.tabs[group] = tab;
    }
    this.writeManifest();
    return item;
  }

  setTabStatus(tabKey, status) {
    if (!this.manifest) return;
    const tab = this.manifest.tabs[tabKey] || { captures: [] };
    tab.status = status;
    this.manifest.tabs[tabKey] = tab;
    this.writeManifest();
  }

  addError(error) {
    if (!this.manifest) return;
    this.manifest.errors.push({
      at: new Date().toISOString(),
      id: String(error?.id || 'TC-UNKNOWN'),
      message: String(error?.message || '').slice(0, 300)
    });
    this.writeManifest();
  }

  finish(status, stopReason) {
    if (!this.manifest) return null;
    this.manifest.status = status;
    this.manifest.stopReason = stopReason || null;
    this.manifest.finishedAt = new Date().toISOString();
    for (const tab of Object.values(this.manifest.tabs)) {
      if (tab.status === 'running') tab.status = status === 'completed' ? 'completed' : 'interrupted';
    }
    this.writeManifest();
    this.#writeReadme();
    return this.getManifest();
  }

  writeDiagnostics(snapshot) {
    if (!this.sessionDir) return;
    atomicWriteJson(path.join(this.sessionDir, 'diagnostics.json'), snapshot, this.logger, false);
  }

  writeManifest() {
    if (!this.sessionDir || !this.manifest) return;
    atomicWriteJson(path.join(this.sessionDir, 'manifest.json'), this.manifest, this.logger, true);
  }

  #writeReadme() {
    if (!this.sessionDir || !this.manifest) return;
    const lines = [
      'VReview Tracker Collector',
      '',
      `Capture date: ${this.manifest.startedAt.slice(0, 10)}`,
      'Source: Tracker.gg',
      `Mode: ${this.manifest.captureMode}`,
      `Status: ${this.manifest.status}`,
      '',
      "This package contains screenshots captured from the user's visible Tracker.gg pages.",
      'No VALORANT process memory or game data was accessed.',
      'No Tracker.gg private/internal API was accessed.',
      'Screenshots were stored locally and are only shared when the user uploads this package.'
    ];
    fs.writeFileSync(path.join(this.sessionDir, 'README.txt'), lines.join('\r\n'), 'utf8');
  }
}

function atomicWriteJson(file, value, logger, keepBackup) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  const backup = `${file}.backup.json`;
  try {
    if (keepBackup && fs.existsSync(file)) {
      try { fs.copyFileSync(file, backup); } catch (error) {
        logger?.warn('tracker.manifest.backup.failed', { message: error.message });
      }
    }
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, file);
  } catch (error) {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

module.exports = { TrackerSessionStore, atomicWriteJson };
