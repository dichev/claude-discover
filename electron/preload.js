import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  listSessions: (date) => ipcRenderer.invoke('sessions:list', date),
  readSession: (id, offset = 0) => ipcRenderer.invoke('sessions:read', id, offset),
  onSessionsUpdate: (cb) => {
    const listener = (_e, sessions) => cb(sessions);
    ipcRenderer.on('sessions:update', listener);
    return () => ipcRenderer.removeListener('sessions:update', listener);
  }
});
