const { contextBridge, ipcRenderer } = require('electron');
const dictionaries = ipcRenderer.sendSync('translations');
let currentLanguage = 'de';
contextBridge.exposeInMainWorld('app', {
  setLanguage: (value) => {
    currentLanguage = Object.hasOwn(dictionaries, value) ? value : 'de';
  },
  t: (key, values = {}) => {
    const text = dictionaries[currentLanguage][key] ?? dictionaries.de[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
  },
  onContext: (callback) => ipcRenderer.on('context', (_, data) => callback(data)),
  onGesture: (callback) => ipcRenderer.on('gesture', (_, data) => callback(data)),
  onTransfer: (callback) => ipcRenderer.on('transfer', (_, data) => callback(data)),
  cancelTransfer: () => ipcRenderer.invoke('cancel-transfer'),
  previewSettingsScale: (value) => ipcRenderer.invoke('preview-settings-scale', value),
  onSettings: (callback) => ipcRenderer.on('settings', (_, data) => callback(data)),
  onWindowState: (callback) => ipcRenderer.on('window-state', (_, state) => callback(state)),
  onUpdateState: (callback) => ipcRenderer.on('update-state', (_, state) => callback(state)),
  updateAction: (action) => ipcRenderer.invoke('update-action', action),
  openRepository: () => ipcRenderer.invoke('open-repository'),
  onAppDialog: (callback) => ipcRenderer.on('app-dialog', (_, data) => callback(data)),
  closeAppDialog: (index) => ipcRenderer.send('app-dialog-close', index),
  action: (id, payload) => ipcRenderer.invoke('action', id, payload),
  renamePreview: (options) => ipcRenderer.invoke('rename-preview', options),
  renameApply: (options, expected) => ipcRenderer.invoke('rename-apply', options, expected),
  close: () => ipcRenderer.send('close-wheel'),
  saveSettings: (value) => ipcRenderer.invoke('save-settings', value),
  chooseDestination: () => ipcRenderer.invoke('choose-destination'),
  chooseProgram: () => ipcRenderer.invoke('choose-program'),
  programIcon: (file) => ipcRenderer.invoke('program-icon', file),
  actionCatalog: () => ipcRenderer.invoke('action-catalog'),
  exportProfile: (slots, programs) => ipcRenderer.invoke('export-profile', slots, programs),
  importProfile: () => ipcRenderer.invoke('import-profile'),
  windowControl: (action) => ipcRenderer.invoke('window-control', action),
});
