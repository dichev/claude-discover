import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('discover', {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  readSession: (id, offset = 0) => ipcRenderer.invoke('sessions:read', id, offset),
  onSessionsUpdate: (cb) => {
    const listener = (_e, sessions) => cb(sessions);
    ipcRenderer.on('sessions:update', listener);
    return () => ipcRenderer.removeListener('sessions:update', listener);
  }
});
