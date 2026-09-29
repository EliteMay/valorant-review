const { autoUpdater } = require('electron-updater');

class UpdaterController {
  constructor({ app, logger, settingsStore }) {
    this.app = app;
    this.logger = logger;
    this.settingsStore = settingsStore;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: message => logger.info('update.info', { message: String(message) }),
      warn: message => logger.warn('update.warn', { message: String(message) }),
      error: message => logger.error('update.error', { message: String(message) }),
      debug: () => {}
    };
  }

  async maybeAutoCheck() {
    if (!this.app.isPackaged) return { status: 'development' };
    if (!this.settingsStore.get().update.autoCheck) return { status: 'disabled' };
    return this.check();
  }

  async check() {
    if (!this.app.isPackaged) return { status: 'development' };
    autoUpdater.channel = this.settingsStore.get().update.channel;
    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo?.version || null;
      return { status: version ? 'checked' : 'unknown', version };
    } catch (error) {
      this.logger.warn('update.check.failed', { message: error.message });
      return { status: 'failed', message: String(error.message || error).slice(0,180) };
    }
  }
}

module.exports = { UpdaterController };
