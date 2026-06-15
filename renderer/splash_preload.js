const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('splashAPI', {
  done:         () => ipcRenderer.send('splash-done'),
  onBackground: (cb) => ipcRenderer.on('splash-background', (_, data) => cb(data)),
  onClose:      (cb) => ipcRenderer.on('splash-close', () => cb()),
  onTheme:      (cb) => ipcRenderer.on('splash-theme', (_, data) => cb(data)),
})
