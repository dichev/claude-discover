import { contextBridge, ipcRenderer } from 'electron'
import { subscribe } from './subscribe.js'

contextBridge.exposeInMainWorld('api', {
  claudeSettings:  ipcRenderer.sendSync('claude-settings:get'),
  getSwitchStatus: name => ipcRenderer.invoke('switch:status', name),
  activateSwitch: name => ipcRenderer.invoke('switch:activate', name),
  deactivateSwitch: name => ipcRenderer.invoke('switch:deactivate', name),
  listSessions: (date, granularity = 'day') => ipcRenderer.invoke('sessions:list', date, granularity),
  readSession: (id, date = null, granularity = 'day') => ipcRenderer.invoke('sessions:read', id, date, granularity),
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
