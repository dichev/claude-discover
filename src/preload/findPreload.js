import { contextBridge, ipcRenderer } from 'electron'

// Dedicated preload for the find-bar overlay view only (see src/main/windows/FindBar.js).
// The main window uses preload.js and never touches these channels.

const subscribe = channel => cb => {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}

contextBridge.exposeInMainWorld('api', {
  findInPage: (text, options) => ipcRenderer.send('find:query', text, options),
  stopFind: () => ipcRenderer.send('find:stop'),
  findClose: () => ipcRenderer.send('find:close'),
  onFindOpen: subscribe('find:open'),
  onFindResult: subscribe('find:result')
})
