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
  getUpdateStatus: () => invoke('updates:get-status'),
  updateNow: () => invoke('updates:update-now'),
  onUpdateStatus: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  },
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
  },
  getRecordingStatus: () => invoke('recording:get-status'),
  prepareRecording: payload => invoke('recording:prepare', payload),
  appendRecordingChunk: chunk => invoke('recording:append-chunk', chunk),
  finishRecording: payload => invoke('recording:finish', payload),
  abortRecording: reason => invoke('recording:abort', reason),
  openRecordingFolder: () => invoke('recording:open-folder'),
  onRecordingStatus: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('recording:status', listener);
    return () => ipcRenderer.removeListener('recording:status', listener);
  }
}));
