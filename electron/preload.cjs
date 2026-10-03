const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('vreviewDesktop', Object.freeze({
  isDesktop: true,
  getInfo: () => invoke('desktop:get-info'),
  getSettings: () => invoke('settings:get'),
  updateSettings: patch => invoke('settings:update', patch),
  resetSettings: () => invoke('settings:reset'),
  chooseRecordingFolder: () => invoke('settings:choose-recording-folder'),
  chooseTrackerFolder: () => invoke('settings:choose-tracker-folder'),
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
  getTrackerStatus: () => invoke('tracker:get-status'),
  listTrackerWindows: () => invoke('tracker:list-windows'),
  previewTrackerWindow: candidateId => invoke('tracker:preview', candidateId),
  selectTrackerWindow: candidateId => invoke('tracker:select-window', candidateId),
  getTrackerCalibration: () => invoke('tracker:get-calibration'),
  saveTrackerCalibration: calibration => invoke('tracker:save-calibration', calibration),
  startTrackerHistory: () => invoke('tracker:start-history'),
  startTrackerCurrentMatch: () => invoke('tracker:start-current-match'),
  stopTrackerCollector: reason => invoke('tracker:stop', reason),
  createTrackerPackage: () => invoke('tracker:create-package'),
  discardRecoveredTrackerSession: () => invoke('tracker:discard-recovery'),
  openTrackerFolder: () => invoke('tracker:open-folder'),
  onTrackerStatus: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('tracker:status', listener);
    return () => ipcRenderer.removeListener('tracker:status', listener);
  },
  onRecordingStatus: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('recording:status', listener);
    return () => ipcRenderer.removeListener('recording:status', listener);
  }
}));
