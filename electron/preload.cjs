const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('vreviewDesktop', Object.freeze({
  isDesktop: true,
  getInfo: () => invoke('desktop:get-info'),
  getSettings: () => invoke('settings:get'),
  updateSettings: patch => invoke('settings:update', patch),
  resetSettings: () => invoke('settings:reset'),
  getDiagnostics: () => invoke('diagnostics:get'),
  openLogFolder: () => invoke('diagnostics:open-log-folder'),
  checkForUpdates: () => invoke('updates:check'),
  listTasks: () => invoke('tasks:list'),
  getTelemetryStatus: () => invoke('telemetry:get-status'),
  startTelemetry: () => invoke('telemetry:start'),
  stopTelemetry: () => invoke('telemetry:stop'),
  openTelemetryFolder: () => invoke('telemetry:open-folder'),
  onTelemetryStatus: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('telemetry:status', listener);
    return () => ipcRenderer.removeListener('telemetry:status', listener);
  }
}));
