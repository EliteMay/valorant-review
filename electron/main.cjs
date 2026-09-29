const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const { SettingsStore } = require('./foundation/settings-store.cjs');
const { Logger } = require('./foundation/logger.cjs');
const { WindowStateStore } = require('./foundation/window-state.cjs');
const { TaskRegistry } = require('./foundation/task-registry.cjs');
const { DesktopDiagnostics } = require('./foundation/diagnostics.cjs');
const { UpdaterController } = require('./updater.cjs');
const { TelemetryController } = require('./telemetry/controller.cjs');

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
let quitAfterTelemetryStop = false;

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
      spellcheck: false
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
    const folder = telemetryController.getSessionDirectory();
    if (!folder) return { ok: false, error: '保存済みTelemetry Sessionがありません。' };
    const error = await shell.openPath(folder);
    return { ok: !error, error: error || null };
  });
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
  diagnostics = new DesktopDiagnostics({ app, logger, settingsStore, taskRegistry, telemetryController });
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
  if (!quitAfterTelemetryStop && telemetryController?.getStatus().active) {
    event.preventDefault();
    quitAfterTelemetryStop = true;
    telemetryController.shutdown()
      .catch(error => logger?.warn('telemetry.quit-stop.failed', { message: error.message }))
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
