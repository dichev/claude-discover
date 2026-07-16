import { contextBridge, ipcRenderer } from 'electron'
import { subscribe } from './subscribe.js'

contextBridge.exposeInMainWorld('api', {
  claudeSettings:  ipcRenderer.sendSync('claude-settings:get'),
  listSessions: (date, granularity = 'day') => ipcRenderer.invoke('sessions:list', date, granularity),
  readSession: (id, offset = 0, date = null, granularity = 'day') => ipcRenderer.invoke('sessions:read', id, offset, date, granularity),
  readRequests: (id, date = null, granularity = 'day') => ipcRenderer.invoke('sessions:read-requests', id, date, granularity),
  onSessionsUpdate: subscribe('sessions:update'),
  onScanProgress: subscribe('sessions:scan-progress'),

  getWorkHours: () => ipcRenderer.invoke('work-hours:get'),
  setWorkHours: (data) => ipcRenderer.invoke('work-hours:set', data),

  runAgentPrompt: (text, systemTools, cache) => ipcRenderer.invoke('agent:run', text, systemTools, cache),
  onAgentOutput: subscribe('agent:output'),

  openLink: (href, baseFile) => ipcRenderer.invoke('shell:open-link', href, baseFile),

  onFindActive: subscribe('find:active'),
  findClose: () => ipcRenderer.send('find:close')
})
