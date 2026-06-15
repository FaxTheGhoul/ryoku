const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('authApi', {
  openPicker: () => ipcRenderer.invoke('auth-open-picker'),
  onResult:   (fn) => ipcRenderer.on('auth-result', (_, data) => fn(data))
})
