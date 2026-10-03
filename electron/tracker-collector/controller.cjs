const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { TrackerWindowsHelper } = require('./windows-helper.cjs');
const { TrackerWindowCapture } = require('./capture.cjs');
const { TrackerSessionStore, atomicWriteJson } = require('./session-store.cjs');
const { createTrackerPackage } = require('./package.cjs');
const {
  COLLECTOR_VERSION,
  TAB_KEYS,
  normalizeTrackerSettings,
  normalizeBounds,
  normalizeCalibration,
  calibrationFits,
  normalizedPointToPermille,
  evaluateBottom,
  estimateRequiredBytes,
  errorInfo
} = require('./core.cjs');

class TrackerCollectorError extends Error {
  constructor(id, detail) {
    const info = errorInfo(id, detail);
    super(info.message);
    this.name = 'TrackerCollectorError';
    this.info = info;
  }
}

class TrackerCollectorController extends EventEmitter {
  constructor({ app, logger, settingsStore, taskRegistry }) {
    super();
    this.app = app;
    this.logger = logger;
    this.settingsStore = settingsStore;
    this.taskRegistry = taskRegistry;
    this.helper = new TrackerWindowsHelper({ app, logger });
    this.capture = new TrackerWindowCapture({ logger });
    this.candidates = new Map();
    this.target = null;
    this.sessionStore = null;
    this.lastSessionDir = null;
    this.taskId = null;
    this.stopRequested = false;
    this.runStartedAt = 0;
    this.state = this.#emptyState();
    this.#recoverInterruptedSession();
  }

  getStatus() {
    return {
      ...this.state,
      collectorVersion: COLLECTOR_VERSION,
      target: this.target ? {
        candidateId: this.target.candidateId,
        title: this.target.title,
        browser: this.target.browser,
        bounds: this.target.bounds
      } : null
    };
  }

  async listWindows() {
    if (process.platform !== 'win32') return [];
    const [nativeWindows, sources] = await Promise.all([
      this.helper.listWindows(),
      this.capture.listSources(420)
    ]);
    this.candidates.clear();

    const candidates = [];
    for (const source of sources) {
      const native = findNativeWindow(source.name, nativeWindows);
      if (!native || native.minimized) continue;
      const candidateId = randomUUID();
      const browser = browserHint(native.title, native.className);
      const candidate = {
        candidateId,
        sourceId: source.id,
        nativeId: native.id,
        title: native.title || source.name,
        browser,
        bounds: normalizeBounds(native.bounds),
        foreground: native.foreground === true,
        trackerRank: trackerRank(native.title),
        previewDataUrl: source.thumbnailDataUrl || null
      };
      this.candidates.set(candidateId, candidate);
      candidates.push(candidate);
    }

    candidates.sort((a, b) => b.trackerRank - a.trackerRank || a.title.localeCompare(b.title, 'ja'));
    return candidates.map(({ sourceId, nativeId, trackerRank, ...safe }) => safe);
  }

  preview(candidateId) {
    const candidate = this.candidates.get(String(candidateId || ''));
    if (!candidate) throw new TrackerCollectorError('TC-WINDOW-001');
    return {
      candidateId: candidate.candidateId,
      title: candidate.title,
      browser: candidate.browser,
      bounds: candidate.bounds,
      previewDataUrl: candidate.previewDataUrl
    };
  }

  async selectWindow(candidateId) {
    const candidate = this.candidates.get(String(candidateId || ''));
    if (!candidate) throw new TrackerCollectorError('TC-WINDOW-001');
    const status = await this.helper.status(candidate.nativeId);
    if (!status.exists) throw new TrackerCollectorError('TC-WINDOW-002');
    if (status.window?.minimized) throw new TrackerCollectorError('TC-WINDOW-003');
    this.target = {
      candidateId: candidate.candidateId,
      sourceId: candidate.sourceId,
      nativeId: candidate.nativeId,
      title: candidate.title,
      browser: candidate.browser,
      bounds: normalizeBounds(status.window?.bounds || candidate.bounds)
    };
    this.#setState({ phase: 'ready', message: '対象ウィンドウを選択しました。', currentScreen: null });
    return this.getStatus();
  }

  async getCalibration() {
    return this.settingsStore.get().tracker?.calibration || null;
  }

  async saveCalibration(input) {
    if (!this.target) throw new TrackerCollectorError('TC-WINDOW-001');
    const calibration = normalizeCalibration({
      ...input,
      geometry: this.target.bounds,
      trackerProfileVersion: 1,
      createdAt: new Date().toISOString()
    });
    if (!calibration) throw new TrackerCollectorError('TC-CAL-001', '5つのTab位置が揃っていません。');
    this.settingsStore.update({ tracker: { calibration } });
    return calibration;
  }

  async startMatchHistory() {
    return this.#run('match-history', async settings => {
      return this.#captureScrollable('match-history', settings, false);
    });
  }

  async startCurrentMatch() {
    return this.#run('current-match', async settings => {
      const calibration = normalizeCalibration(this.settingsStore.get().tracker?.calibration || {});
      if (!calibration) throw new TrackerCollectorError('TC-CAL-001');

      const status = await this.#targetStatus();
      const bounds = normalizeBounds(status.window.bounds);
      if (!calibrationFits(calibration, bounds)) throw new TrackerCollectorError('TC-CAL-002');

      for (let tabIndex = 0; tabIndex < TAB_KEYS.length; tabIndex++) {
        this.#throwIfStopped();
        const tab = TAB_KEYS[tabIndex];
        this.sessionStore.setTabStatus(tab, 'running');
        this.#setState({
          currentScreen: tab,
          currentTabIndex: tabIndex + 1,
          currentTabTotal: TAB_KEYS.length,
          message: `${tab} Tabへ切替中`
        });

        await this.#waitForFocus(settings);
        const point = normalizedPointToPermille(calibration.points[tab]);
        const clicked = await this.helper.click(this.target.nativeId, point);
        if (!clicked.ok) throw new TrackerCollectorError('TC-TAB-003', tab);

        await delay(180);
        await this.#waitForFocus(settings);
        const home = await this.helper.home(this.target.nativeId);
        if (!home.ok) throw new TrackerCollectorError('TC-TAB-003', `${tab}: home`);
        await delay(180);

        await this.#captureScrollable(tab, settings, false);
        this.sessionStore.setTabStatus(tab, 'completed');
      }
      return { stopReason: 'all-tabs-completed' };
    });
  }

  requestStop(reason = 'user-stop') {
    if (!this.state.active) return this.getStatus();
    this.stopRequested = true;
    this.#setState({ phase: 'stopping', message: '安全停止しています…', stopReason: reason });
    return this.getStatus();
  }

  async createPackage() {
    const sessionDir = this.lastSessionDir || this.sessionStore?.getSessionDirectory();
    if (!sessionDir) throw new TrackerCollectorError('TC-PACKAGE-001', '保存済みSessionがありません。');
    this.#setState({ packageStatus: 'creating', message: 'ChatGPT用Packageを作成中…' });
    try {
      const settings = normalizeTrackerSettings(this.settingsStore.get().tracker || {});
      const result = await createTrackerPackage({
        app: this.app,
        sessionDir,
        compression: settings.packageCompression,
        logger: this.logger
      });
      this.#setState({
        packageStatus: 'completed',
        packagePath: result.outputPath,
        packageBytes: result.bytes,
        message: 'ChatGPT用Packageを作成しました。'
      });
      return result;
    } catch (error) {
      this.#setState({ packageStatus: 'failed', lastError: errorInfo('TC-PACKAGE-001', error.message) });
      throw new TrackerCollectorError('TC-PACKAGE-001', error.message);
    }
  }

  getLastSessionDirectory() {
    return this.lastSessionDir || null;
  }

  discardRecoveredSession() {
    const recovered = this.state.recoveredSession;
    if (!recovered?.directory) return { ok: false, error: '復旧対象Sessionがありません。' };
    const settings = normalizeTrackerSettings(this.settingsStore.get().tracker || {});
    const root = resolveRootDirectory(settings.saveDirectory, this.app.getPath('userData'));
    const directory = path.resolve(recovered.directory);
    const rootPath = path.resolve(root);
    if (!directory.startsWith(rootPath + path.sep)) {
      throw new Error('Recovered Tracker session path was rejected.');
    }
    fs.rmSync(directory, { recursive: true, force: true });
    if (this.lastSessionDir === directory) this.lastSessionDir = null;
    this.#setState({ recoveredSession: null, message: '途中終了Sessionを破棄しました。' });
    return { ok: true };
  }

  async #run(mode, worker) {
    if (this.state.active) return this.getStatus();
    if (!this.target) throw new TrackerCollectorError('TC-WINDOW-001');
    const settings = normalizeTrackerSettings(this.settingsStore.get().tracker || {});
    const status = await this.#targetStatus();
    if (status.window.minimized) throw new TrackerCollectorError('TC-WINDOW-003');
    this.target.bounds = normalizeBounds(status.window.bounds);

    const root = resolveRootDirectory(settings.saveDirectory, this.app.getPath('userData'));
    ensureDiskSpace(root, estimateRequiredBytes(this.target.bounds, settings.maxCaptures));

    this.sessionStore = new TrackerSessionStore({ rootDirectory: root, logger: this.logger });
    const created = this.sessionStore.create({
      mode,
      browser: this.target.browser || settings.browserTarget,
      windowInfo: this.target,
      settings
    });
    this.lastSessionDir = created.sessionDir;
    this.stopRequested = false;
    this.runStartedAt = Date.now();

    const task = this.taskRegistry?.create({ type: 'tracker-collector' });
    this.taskId = task?.id || null;
    if (this.taskId) this.taskRegistry.update(this.taskId, { state: 'running', message: 'Tracker画面を収集中' });

    this.#setState({
      phase: 'running',
      active: true,
      captureMode: mode,
      sessionId: created.sessionId,
      sessionDirectory: created.sessionDir,
      captureCount: 0,
      currentScreen: mode,
      currentTabIndex: 0,
      currentTabTotal: mode === 'current-match' ? TAB_KEYS.length : 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      stopReason: null,
      lastError: null,
      message: '収集を開始しました。'
    });

    let outcome = 'completed';
    let stopReason = 'completed';
    try {
      const result = await worker(settings);
      stopReason = result?.stopReason || 'completed';
      if (this.stopRequested) {
        outcome = 'interrupted';
        stopReason = this.state.stopReason || 'user-stop';
      }
    } catch (error) {
      if (this.stopRequested) {
        outcome = 'interrupted';
        stopReason = this.state.stopReason || 'user-stop';
      } else {
        outcome = 'failed';
        const info = error instanceof TrackerCollectorError ? error.info : errorInfo('TC-CAPTURE-001', error.message);
        this.sessionStore.addError(info);
        this.#setState({ lastError: info });
        stopReason = info.id;
      }
    }

    const manifest = this.sessionStore.finish(outcome, stopReason);
    const diagnostics = this.#diagnosticsSnapshot(outcome, stopReason);
    this.sessionStore.writeDiagnostics(diagnostics);
    if (this.taskId) {
      this.taskRegistry?.update(this.taskId, {
        state: outcome === 'completed' ? 'completed' : outcome === 'failed' ? 'failed' : 'interrupted',
        progress: outcome === 'completed' ? 1 : null,
        message: outcome === 'completed' ? 'Tracker収集が完了しました。' : 'Tracker収集を終了しました。'
      });
      this.taskId = null;
    }

    this.#setState({
      phase: outcome,
      active: false,
      finishedAt: new Date().toISOString(),
      stopReason,
      message: outcome === 'completed' ? 'Tracker収集が完了しました。' : outcome === 'interrupted' ? 'Tracker収集を安全停止しました。' : 'Tracker収集でエラーが発生しました。'
    });
    this.stopRequested = false;

    if (outcome === 'completed' && settings.autoOpenResultFolder) {
      this.emit('request-open-result', created.sessionDir);
    }
    return { status: this.getStatus(), manifest };
  }

  async #captureScrollable(group, settings) {
    const maxCaptures = settings.maxCaptures;
    let previousBitmap = null;
    let bottomStreak = 0;
    let lastEvaluation = null;

    for (let index = 1; index <= maxCaptures; index++) {
      this.#throwIfStopped();
      this.#throwIfTimedOut(settings);
      await this.#waitForFocus(settings);

      this.#setState({ currentScreen: group, message: '画面安定待ち' });
      const frame = await this.capture.waitStable(this.target.sourceId, this.target.bounds, settings);
      this.#throwIfStopped();

      if (previousBitmap) {
        lastEvaluation = evaluateBottom(previousBitmap, frame.bitmap, bottomStreak);
        bottomStreak = lastEvaluation.streak;
        if (lastEvaluation.atBottom) {
          return { stopReason: 'bottom-inferred', evaluation: lastEvaluation };
        }
      }

      const dir = this.sessionStore.captureDirectory(group);
      const fileName = `raw-${String(index).padStart(3, '0')}.png`;
      fs.writeFileSync(path.join(dir, fileName), frame.image.toPNG());
      this.sessionStore.addCapture({
        group,
        fileName,
        width: frame.width,
        height: frame.height,
        stable: frame.stable,
        diff: lastEvaluation?.fullDiff ?? null
      });
      previousBitmap = frame.bitmap;
      this.#setState({
        captureCount: this.sessionStore.getManifest().captures.length,
        currentGroupCapture: index,
        message: `Capture ${index} 保存済み`
      });

      if (index >= maxCaptures) {
        return { stopReason: 'safety-limit' };
      }

      const scrollNotches = Math.max(3, Math.round(7 * settings.scrollStepRatio));
      const scroll = await this.helper.scroll(this.target.nativeId, -scrollNotches);
      if (!scroll.ok) {
        const status = await this.#targetStatus();
        if (!status.window.foreground) continue;
        throw new TrackerCollectorError('TC-SCROLL-002', scroll.reason || group);
      }
      await delay(120);
    }

    return { stopReason: 'safety-limit' };
  }

  async #waitForFocus(settings) {
    while (true) {
      this.#throwIfStopped();
      this.#throwIfTimedOut(settings);
      const status = await this.#targetStatus();
      if (status.window.minimized) throw new TrackerCollectorError('TC-WINDOW-003');
      if (status.window.foreground) {
        if (this.state.phase === 'paused-focus') {
          this.#setState({ phase: 'running', message: '対象ブラウザへ戻ったため再開しました。' });
        }
        this.target.bounds = normalizeBounds(status.window.bounds);
        return;
      }
      this.#setState({
        phase: 'paused-focus',
        message: '対象ブラウザからフォーカスが外れました。Tracker.ggのChromeを前面に戻してください。'
      });
      await delay(350);
    }
  }

  async #targetStatus() {
    const result = await this.helper.status(this.target.nativeId);
    if (!result.exists) throw new TrackerCollectorError('TC-WINDOW-002');
    return result;
  }

  #throwIfStopped() {
    if (this.stopRequested) throw new TrackerCollectorError('TC-STOP-001');
  }

  #throwIfTimedOut(settings) {
    if (this.runStartedAt && Date.now() - this.runStartedAt > settings.maxDurationMs) {
      throw new TrackerCollectorError('TC-STOP-001', '最大実行時間に到達しました。');
    }
  }

  #recoverInterruptedSession() {
    try {
      const settings = normalizeTrackerSettings(this.settingsStore.get().tracker || {});
      const root = resolveRootDirectory(settings.saveDirectory, this.app.getPath('userData'));
      const recovered = findLatestRunningSession(root);
      if (!recovered) return;
      const manifest = {
        ...recovered.manifest,
        status: 'interrupted',
        finishedAt: new Date().toISOString(),
        stopReason: 'crash-recovery'
      };
      atomicWriteJson(recovered.manifestPath, manifest, this.logger, true);
      this.lastSessionDir = recovered.directory;
      this.state = {
        ...this.state,
        phase: 'interrupted',
        captureCount: Array.isArray(manifest.captures) ? manifest.captures.length : 0,
        sessionDirectory: recovered.directory,
        stopReason: 'crash-recovery',
        message: '前回のTracker収集Sessionが途中終了しました。結果を確認・Package化・破棄できます。',
        recoveredSession: {
          directory: recovered.directory,
          sessionId: manifest.sessionId || null,
          captureCount: Array.isArray(manifest.captures) ? manifest.captures.length : 0
        }
      };
    } catch (error) {
      this.logger?.warn('tracker.recovery.failed', { message: String(error?.message || error).slice(0, 220) });
    }
  }

  #diagnosticsSnapshot(outcome, stopReason) {
    return {
      schema: 'vreview-tracker-diagnostics',
      schemaVersion: 1,
      collectorVersion: COLLECTOR_VERSION,
      browser: this.target?.browser || null,
      windowTitle: this.target?.title || null,
      windowBounds: this.target?.bounds || null,
      displayScale: this.target?.bounds?.scaleFactor || null,
      captureCount: this.sessionStore?.getManifest()?.captures?.length || 0,
      captureDurationMs: this.runStartedAt ? Date.now() - this.runStartedAt : 0,
      stopReason,
      outcome,
      errorId: this.state.lastError?.id || null,
      lastSuccessfulStep: this.state.currentScreen || null,
      calibrationVersion: this.settingsStore.get().tracker?.calibration?.trackerProfileVersion || null,
      containsImages: false,
      containsCredentials: false
    };
  }

  #setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.getStatus());
  }

  #emptyState() {
    return {
      phase: 'idle',
      active: false,
      captureMode: null,
      sessionId: null,
      sessionDirectory: null,
      captureCount: 0,
      currentGroupCapture: 0,
      currentScreen: null,
      currentTabIndex: 0,
      currentTabTotal: 0,
      startedAt: null,
      finishedAt: null,
      stopReason: null,
      lastError: null,
      message: '待機中',
      packageStatus: 'idle',
      packagePath: null,
      packageBytes: 0,
      recoveredSession: null
    };
  }
}

function trackerRank(title) {
  const value = String(title || '').toLowerCase();
  if (value.includes('tracker.gg')) return 100;
  if (value.includes('tracker network')) return 90;
  if (value.includes('tracker')) return 60;
  return 0;
}

function browserHint(title, className) {
  const value = `${title || ''} ${className || ''}`.toLowerCase();
  if (value.includes('firefox') || value.includes('mozillawindowclass')) return 'firefox';
  if (value.includes('edge')) return 'edge';
  if (value.includes('chrome') || value.includes('chrome_widget')) return 'chrome';
  return 'unknown';
}

function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findNativeWindow(sourceName, windows) {
  const source = normalizeTitle(sourceName);
  const exact = windows.filter(item => normalizeTitle(item.title) === source);
  if (exact.length === 1) return exact[0];
  const near = windows.filter(item => {
    const title = normalizeTitle(item.title);
    return title && source && (title.includes(source) || source.includes(title));
  });
  return near.length === 1 ? near[0] : null;
}

function resolveRootDirectory(configured, userData) {
  const value = String(configured || '').trim();
  return value || path.join(userData, 'TrackerCaptures');
}

function ensureDiskSpace(root, requiredBytes) {
  fs.mkdirSync(root, { recursive: true });
  if (typeof fs.statfsSync !== 'function') return;
  const stats = fs.statfsSync(root);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  if (Number.isFinite(freeBytes) && freeBytes < requiredBytes) {
    const freeMb = Math.round(freeBytes / 1024 / 1024);
    const requiredMb = Math.round(requiredBytes / 1024 / 1024);
    throw new TrackerCollectorError('TC-DISK-001', `必要見積 ${requiredMb} MB / 空き ${freeMb} MB`);
  }
}

function findLatestRunningSession(root) {
  if (!fs.existsSync(root)) return null;
  const dateDirs = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map(entry => entry.name)
    .sort()
    .reverse();
  for (const date of dateDirs.slice(0, 14)) {
    const datePath = path.join(root, date);
    const sessions = fs.readdirSync(datePath, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith('session-'))
      .map(entry => entry.name)
      .sort()
      .reverse();
    for (const name of sessions) {
      const directory = path.join(datePath, name);
      const manifestPath = path.join(directory, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest?.schema === 'vreview-tracker-capture-session' && manifest.status === 'running') {
          return { directory, manifestPath, manifest };
        }
      } catch {
        // Ignore unrelated/corrupt sessions; raw captures remain untouched.
      }
    }
  }
  return null;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  TrackerCollectorController,
  TrackerCollectorError,
  trackerRank,
  browserHint,
  findNativeWindow
};
