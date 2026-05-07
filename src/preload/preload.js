import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  listSessions: (date) => ipcRenderer.invoke('sessions:list', date),
  readSession: (id, offset = 0, date = null) => ipcRenderer.invoke('sessions:read', id, offset, date),
  onSessionsUpdate: (cb) => {
    const listener = (_e, sessions) => cb(sessions)
    ipcRenderer.on('sessions:update', listener)
    return () => { ipcRenderer.removeListener('sessions:update', listener) }
  },
  getWorkHours: () => ipcRenderer.invoke('work-hours:get'),
  setWorkHours: (data) => ipcRenderer.invoke('work-hours:set', data),
  readLogFile: (filePath) => ipcRenderer.invoke('sessions:read-log-file', filePath),
  runAgentPrompt: (text, systemTools) => ipcRenderer.invoke('agent:run', text, systemTools),
  onAgentOutput: (cb) => {
    const listener = (_e, chunk) => cb(chunk)
    ipcRenderer.on('agent:output', listener)
    return () => { ipcRenderer.removeListener('agent:output', listener) }
  }
})
