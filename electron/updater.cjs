const { EventEmitter } = require('node:events');
const { autoUpdater } = require('electron-updater');
const { compareVersions } = require('./foundation/version-compare.cjs');

class UpdaterController extends EventEmitter {
  constructor({ app, logger, settingsStore }) {
    super();
    this.app = app;
    this.logger = logger;
    this.settingsStore = settingsStore;
    this.state = {
      status: 'idle',
      currentVersion: app.getVersion(),
      version: null,
      percent: null,
      message: null
    };

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.logger = {
      info: message => logger.info('update.info', { message: String(message) }),
      warn: message => logger.warn('update.warn', { message: String(message) }),
      error: message => logger.error('update.error', { message: String(message) }),
      debug: () => {}
    };

    autoUpdater.on('checking-for-update', () => this.#setState({ status: 'checking', percent: null, message: null }));
    autoUpdater.on('update-available', info => this.#setState({ status: 'available', version: info?.version || null, percent: null, message: null }));
    autoUpdater.on('update-not-available', info => this.#setState({ status: 'up-to-date', version: info?.version || this.app.getVersion(), percent: null, message: null }));
    autoUpdater.on('download-progress', progress => this.#setState({
      status: 'downloading',
      percent: Number.isFinite(Number(progress?.percent)) ? Math.max(0, Math.min(100, Number(progress.percent))) : null,
      message: null
    }));
    autoUpdater.on('update-downloaded', info => this.#setState({
      status: 'downloaded',
      version: info?.version || this.state.version,
      percent: 100,
      message: null
    }));
    autoUpdater.on('error', error => {
      this.logger.error('update.event.error', { message: error?.message || String(error) });
      this.#setState({
        status: 'failed',
        percent: null,
        message: String(error?.message || error).slice(0, 180)
      });
    });
  }

  getStatus() {
    return { ...this.state };
  }

  async maybeAutoCheck() {
    if (!this.app.isPackaged) return this.#development();
    if (!this.settingsStore.get().update.autoCheck) return { status: 'disabled', currentVersion: this.app.getVersion() };
    return this.check();
  }

  async check() {
    if (!this.app.isPackaged) return this.#development();
    this.#configureChannel();

    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo?.version || null;
      if (!version || compareVersions(version, this.app.getVersion()) <= 0) {
        this.#setState({ status: 'up-to-date', version: version || this.app.getVersion(), percent: null, message: null });
      } else {
        this.#setState({ status: 'available', version, percent: null, message: null });
      }
      return this.getStatus();
    } catch (error) {
      return this.#fail('update.check.failed', error);
    }
  }

  async downloadLatest() {
    if (!this.app.isPackaged) return this.#development();
    this.#configureChannel();

    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo?.version || null;

      if (!version || compareVersions(version, this.app.getVersion()) <= 0) {
        this.#setState({ status: 'up-to-date', version: version || this.app.getVersion(), percent: null, message: null });
        return this.getStatus();
      }

      this.#setState({ status: 'downloading', version, percent: 0, message: null });
      await autoUpdater.downloadUpdate();

      if (this.state.status !== 'downloaded') {
        this.#setState({ status: 'downloaded', version, percent: 100, message: null });
      }
      return this.getStatus();
    } catch (error) {
      return this.#fail('update.download.failed', error);
    }
  }

  installDownloaded() {
    if (!this.app.isPackaged) return this.#development();
    if (this.state.status !== 'downloaded') {
      return { ...this.getStatus(), message: 'ダウンロード済みUpdateがありません。' };
    }

    this.#setState({ status: 'installing', percent: 100, message: 'Updateを適用して再起動します。' });
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        this.#fail('update.install.failed', error);
      }
    }, 400);

    return this.getStatus();
  }

  #configureChannel() {
    const channel = this.settingsStore.get().update.channel;
    autoUpdater.channel = channel;
    autoUpdater.allowPrerelease = channel === 'beta';
  }

  #development() {
    this.#setState({ status: 'development', version: this.app.getVersion(), percent: null, message: null });
    return this.getStatus();
  }

  #fail(event, error) {
    this.logger.warn(event, { message: error?.message || String(error) });
    this.#setState({
      status: 'failed',
      percent: null,
      message: String(error?.message || error).slice(0, 180)
    });
    return this.getStatus();
  }

  #setState(patch) {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: this.app.getVersion()
    };
    this.emit('status', this.getStatus());
  }
}

module.exports = { UpdaterController };
