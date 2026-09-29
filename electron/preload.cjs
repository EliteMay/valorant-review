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
  listTasks: () => invoke('tasks:list')
}));
