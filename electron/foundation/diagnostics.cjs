const fs = require('node:fs');
const path = require('node:path');

class DesktopDiagnostics {
  constructor({ app, logger, settingsStore, taskRegistry, telemetryController = null }) {
    this.app = app;
    this.logger = logger;
    this.settingsStore = settingsStore;
    this.taskRegistry = taskRegistry;
    this.telemetryController = telemetryController;
    this.startedAt = new Date().toISOString();
    this.lastRendererFailure = null;
  }

  noteRendererFailure(details) {
    this.lastRendererFailure = {
      at: new Date().toISOString(),
      reason: String(details?.reason || 'unknown').slice(0,120),
      exitCode: Number.isFinite(Number(details?.exitCode)) ? Number(details.exitCode) : null
    };
  }

  snapshot() {
    const userData = this.app.getPath('userData');
    const logs = this.app.getPath('logs');
    return {
      schema: 'vreview-desktop-diagnostics',
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      startedAt: this.startedAt,
      app: {
        version: this.app.getVersion(),
        packaged: this.app.isPackaged,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch
      },
      paths: {
        userDataKind: path.basename(userData),
        logsKind: path.basename(logs)
      },
      storage: {
        settingsExists: fs.existsSync(path.join(userData, 'settings.json')),
        windowStateExists: fs.existsSync(path.join(userData, 'window-state.json'))
      },
      update: {
        autoCheck: this.settingsStore.get().update.autoCheck,
        channel: this.settingsStore.get().update.channel
      },
      tasks: this.taskRegistry.list(),
      telemetry: sanitizeTelemetry(this.telemetryController?.getStatus?.()),
      lastRendererFailure: this.lastRendererFailure,
      privacy: {
        includesVideoBody: false,
        includesFileContents: false,
        includesSecrets: false
      }
    };
  }
}

function sanitizeTelemetry(status) {
  if (!status) return null;
  return {
    supported: Boolean(status.supported),
    helperAvailable: Boolean(status.helperAvailable),
    active: Boolean(status.active),
    phase: String(status.phase || 'unknown'),
    inputEvents: Number(status.inputEvents || 0),
    mouseSamples: Number(status.mouseSamples || 0),
    buttonEvents: Number(status.buttonEvents || 0),
    keyEvents: Number(status.keyEvents || 0),
    invalidEvents: Number(status.invalidEvents || 0),
    valorantForeground: Boolean(status.valorantForeground)
  };
}

module.exports = { DesktopDiagnostics };
