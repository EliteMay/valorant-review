const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell, screen } = require('electron');
const { SettingsStore } = require('./foundation/settings-store.cjs');
const { Logger } = require('./foundation/logger.cjs');
const { WindowStateStore } = require('./foundation/window-state.cjs');
const { TaskRegistry } = require('./foundation/task-registry.cjs');
const { DesktopDiagnostics } = require('./foundation/diagnostics.cjs');
const { UpdaterController } = require('./updater.cjs');
const { TelemetryController } = require('./telemetry/controller.cjs');
const { RecordingController } = require('./recording/controller.cjs');

const APP_ID = 'io.github.elitemay.vreview';
app.setAppUserModelId(APP_ID);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow = null;
let settingsStore = null;
let logger = null;
let windowStateStore = null;
let taskRegistry = null;
let diagnostics = null;
let updater = null;
let telemetryController = null;
let recordingController = null;
let quitAfterCaptureStop = false;

function createWindow() {
  const state = windowStateStore.load();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#07090c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.noteRendererFailure(details);
    logger.error('renderer.gone', { reason: details.reason, exitCode: details.exitCode });
  });
  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    win.show();
  });
  win.on('close', () => windowStateStore.save(win));
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  win.loadFile(path.join(__dirname, '..', 'index.html')).catch(error => {
    logger.error('window.load.failed', { message: error.message });
  });
  return win;
}

function registerIpc() {
  ipcMain.handle('desktop:get-info', () => ({
    desktop: true,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged
  }));
  ipcMain.handle('settings:get', () => settingsStore.get());
  ipcMain.handle('settings:update', (_event, patch) => settingsStore.update(patch && typeof patch === 'object' ? patch : {}));
  ipcMain.handle('settings:reset', () => settingsStore.reset());
  ipcMain.handle('diagnostics:get', () => diagnostics.snapshot());
  ipcMain.handle('diagnostics:open-log-folder', async () => {
    const error = await shell.openPath(app.getPath('logs'));
    return { ok: !error, error: error || null };
  });
  ipcMain.handle('updates:check', () => updater.check());
  ipcMain.handle('updates:get-status', () => updater.getStatus());
  ipcMain.handle('updates:update-now', async () => {
    const result = await updater.downloadLatest();
    if (result.status !== 'downloaded') return result;

    if (recordingController?.getStatus().active) {
      await recordingController.abort('update-install');
    }
    if (telemetryController?.getStatus().active) {
      await telemetryController.shutdown();
    }

    return updater.installDownloaded();
  });
  ipcMain.handle('tasks:list', () => taskRegistry.list());
  ipcMain.handle('telemetry:get-status', () => telemetryController.getStatus());
  ipcMain.handle('telemetry:start', () => telemetryController.start());
  ipcMain.handle('telemetry:stop', () => telemetryController.stop());
  ipcMain.handle('telemetry:open-folder', async () => {
    const folder = recordingController?.getSessionDirectory() || telemetryController.getSessionDirectory();
    if (!folder) return { ok: false, error: '保存済みSessionがありません。' };
    const error = await shell.openPath(folder);
    return { ok: !error, error: error || null };
  });

  ipcMain.handle('recording:get-status', () => recordingController.getStatus());
  ipcMain.handle('recording:prepare', async (_event, payload) => {
    let telemetry = telemetryController.getStatus();
    if (!telemetry.active) telemetry = await telemetryController.start();

    const sessionDir = telemetryController.getSessionDirectory();
    if (!sessionDir || !telemetry.sessionId) {
      await telemetryController.shutdown().catch(() => {});
      throw new Error('Session保存先を準備できませんでした。');
    }

    return recordingController.prepare({
      sessionDir,
      sessionId: telemetry.sessionId,
      mimeType: payload?.mimeType,
      video: payload?.video,
      audio: payload?.audio
    });
  });

  ipcMain.on('recording:chunk', (event, chunk) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) return;
    recordingController.appendChunk(chunk);
  });

  ipcMain.handle('recording:finish', async (_event, payload) => {
    const recording = await recordingController.finish(payload || {});
    if (telemetryController.getStatus().active) await telemetryController.stop();
    const telemetry = telemetryController.getStatus();
    writeCaptureSessionManifest(recording, telemetry);
    return { recording, telemetry };
  });

  ipcMain.handle('recording:abort', async (_event, reason) => {
    const recording = await recordingController.abort(reason || 'renderer-abort');
    if (telemetryController.getStatus().active) await telemetryController.stop();
    const telemetry = telemetryController.getStatus();
    writeCaptureSessionManifest(recording, telemetry);
    return { recording, telemetry };
  });

  ipcMain.handle('recording:open-folder', async () => {
    const folder = recordingController.getSessionDirectory() || telemetryController.getSessionDirectory();
    if (!folder) return { ok: false, error: '保存済みSessionがありません。' };
    const error = await shell.openPath(folder);
    return { ok: !error, error: error || null };
  });
}

function writeCaptureSessionManifest(recording, telemetry) {
  const folder = recordingController?.getSessionDirectory() || telemetryController?.getSessionDirectory();
  if (!folder) return false;

  const recordingComplete = recording?.phase === 'completed';
  const telemetryComplete = telemetry?.phase === 'stopped';
  const manifest = {
    schema: 'vreview-session',
    schemaVersion: 1,
    id: recording?.sessionId || telemetry?.sessionId || null,
    createdAt: telemetry?.startedAt || recording?.startedAt || new Date().toISOString(),
    completedAt: recording?.endedAt || telemetry?.endedAt || null,
    sourceVideo: {
      file: recording?.fileName || 'gameplay.webm',
      pathStored: false,
      contentHash: null,
      durationMs: null,
      width: recording?.video?.width ?? null,
      height: recording?.video?.height ?? null,
      fps: recording?.video?.frameRate ?? null,
      variableFrameRate: null
    },
    recording: {
      available: Boolean(recording?.fileName),
      complete: recordingComplete,
      manifest: 'recording.json',
      mimeType: recording?.mimeType || null,
      bytesWritten: Number(recording?.bytesWritten || 0),
      systemAudio: Boolean(recording?.audio?.enabled)
    },
    telemetry: {
      available: Boolean(telemetry?.sessionId),
      complete: telemetryComplete,
      manifest: 'telemetry-session.json',
      events: 'telemetry.ndjson',
      clockSync: 'pending',
      clockOffsetMs: null,
      clockDriftPpm: null
    },
    files: {
      video: recording?.fileName || 'gameplay.webm',
      recordingManifest: 'recording.json',
      telemetryManifest: 'telemetry-session.json',
      telemetryEvents: 'telemetry.ndjson'
    },
    analysisState: recordingComplete && telemetryComplete ? 'new' : 'interrupted'
  };

  const file = path.join(folder, 'session.json');
  const temp = `${file}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(manifest, null, 2), 'utf8');
    fs.renameSync(temp, file);
    return true;
  } catch (error) {
    logger?.warn('capture.session-manifest.failed', { message: error.message });
    return false;
  }
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  logger = new Logger(app.getPath('logs'));
  settingsStore = new SettingsStore(app.getPath('userData'), logger);
  windowStateStore = new WindowStateStore(app.getPath('userData'), screen, logger);
  taskRegistry = new TaskRegistry(logger);
  telemetryController = new TelemetryController({ app, logger, taskRegistry });
  recordingController = new RecordingController({ logger });
  diagnostics = new DesktopDiagnostics({ app, logger, settingsStore, taskRegistry, telemetryController, recordingController });
  updater = new UpdaterController({ app, logger, settingsStore });
  updater.on('status', status => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('updates:status', status);
    }
  });
  telemetryController.on('status', status => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('telemetry:status', status);
    }
  });
  recordingController.on('status', status => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('recording:status', status);
    }
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const currentUrl = String(mainWindow?.webContents?.getURL?.() || '');
      const isLocalReview = currentUrl.startsWith('file://') && currentUrl.endsWith('/review.html');
      if (!request.videoRequested || !isLocalReview) {
        callback(null);
        return;
      }

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      });

      const primaryDisplayId = String(screen.getPrimaryDisplay().id);
      const primaryScreen = sources.find(source => source.display_id === primaryDisplayId);
      const source = primaryScreen || sources[0];

      if (!source) {
        callback(null);
        return;
      }

      const grant = { video: source };
      if (request.audioRequested && process.platform === 'win32') grant.audio = 'loopback';
      callback(grant);
    } catch (error) {
      logger?.warn('recording.display-grant.failed', { message: error.message });
      callback(null);
    }
  });

  registerIpc();

  logger.info('app.ready', { version: app.getVersion(), packaged: app.isPackaged });
  mainWindow = createWindow();
  updater.maybeAutoCheck().catch(error => logger.warn('update.auto.failed', { message: error.message }));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
}).catch(error => {
  logger?.error('app.ready.failed', { message: error.message });
  app.quit();
});

app.on('before-quit', event => {
  const captureActive = recordingController?.getStatus().active || telemetryController?.getStatus().active;
  if (!quitAfterCaptureStop && captureActive) {
    event.preventDefault();
    quitAfterCaptureStop = true;
    let finalRecording = recordingController?.getStatus();
    Promise.resolve()
      .then(async () => {
        if (recordingController?.getStatus().active) finalRecording = await recordingController.abort('app-quit');
      })
      .then(() => telemetryController?.getStatus().active ? telemetryController.shutdown() : null)
      .then(() => writeCaptureSessionManifest(finalRecording, telemetryController?.getStatus()))
      .catch(error => logger?.warn('capture.quit-stop.failed', { message: error.message }))
      .finally(() => app.quit());
    return;
  }

  taskRegistry?.interruptRunning();
  if (mainWindow && !mainWindow.isDestroyed()) windowStateStore?.save(mainWindow);
  logger?.info('app.before-quit');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
