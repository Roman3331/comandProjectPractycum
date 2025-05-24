const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (credentials) => ipcRenderer.invoke('login', credentials),
  logout: () => ipcRenderer.invoke('logout'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  createBMP: (options) => ipcRenderer.invoke('create-bmp', options),
  hideMessage: (options) => ipcRenderer.invoke('hide-message', options),
  extractMessage: () => ipcRenderer.invoke('extract-message'),
  getUserData: () => ipcRenderer.invoke('get-user-data'),
  showInstructions: () => ipcRenderer.invoke('show-instructions'),
  showAboutProgram: () => ipcRenderer.invoke('show-about-program'),
  showAuthors: () => ipcRenderer.invoke('show-authors'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings)
});
