import { contextBridge, ipcRenderer } from 'electron'

const subscribe = channel => cb => {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}

contextBridge.exposeInMainWorld('api', {
  claudeDir:     ipcRenderer.sendSync('claude-dir:get'),
  hookInstalled: ipcRenderer.sendSync('hook:installed:get'),
  listSessions: (date) => ipcRenderer.invoke('sessions:list', date),
  readSession: (id, offset = 0, date = null) => ipcRenderer.invoke('sessions:read', id, offset, date),
  onSessionsUpdate: subscribe('sessions:update'),

  getWorkHours: () => ipcRenderer.invoke('work-hours:get'),
  setWorkHours: (data) => ipcRenderer.invoke('work-hours:set', data),

  runAgentPrompt: (text, systemTools) => ipcRenderer.invoke('agent:run', text, systemTools),
  getAgentUsage: () => ipcRenderer.invoke('agent:usage'),
  onAgentUsage: subscribe('agent:usage-update'),
  onAgentOutput: subscribe('agent:output')
})
