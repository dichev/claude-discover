import { contextBridge, ipcRenderer } from 'electron'
import { subscribe } from './subscribe.js'

contextBridge.exposeInMainWorld('api', {
  claudeDir:     ipcRenderer.sendSync('claude-dir:get'),
  hookInstalled: ipcRenderer.sendSync('hook:installed:get'),
  listSessions: (date, granularity = 'day') => ipcRenderer.invoke('sessions:list', date, granularity),
  readSession: (id, offset = 0, date = null, granularity = 'day') => ipcRenderer.invoke('sessions:read', id, offset, date, granularity),
  onSessionsUpdate: subscribe('sessions:update'),

  getWorkHours: () => ipcRenderer.invoke('work-hours:get'),
  setWorkHours: (data) => ipcRenderer.invoke('work-hours:set', data),

  runAgentPrompt: (text, systemTools) => ipcRenderer.invoke('agent:run', text, systemTools),
  onAgentOutput: subscribe('agent:output'),

  openLink: (href, baseFile) => ipcRenderer.invoke('shell:open-link', href, baseFile)
})
