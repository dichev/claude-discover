import { contextBridge, ipcRenderer, webUtils } from 'electron'

const subscribe = channel => cb => {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}

contextBridge.exposeInMainWorld('api', {
  claudeSettings:  ipcRenderer.sendSync('claude-settings:get'),
  getSwitchStatus: name => ipcRenderer.invoke('switch:status', name),
  activateSwitch: name => ipcRenderer.invoke('switch:activate', name),
  deactivateSwitch: name => ipcRenderer.invoke('switch:deactivate', name),
  setSwitchKeepActive: (name, value) => ipcRenderer.invoke('switch:keep-active', name, value),
  listSessions: (date, granularity = 'day') => ipcRenderer.invoke('sessions:list', date, granularity),
  readSession: (filePath, date = null, granularity = 'day') => ipcRenderer.invoke('sessions:read', filePath, date, granularity),
  readRequests: (filePath, date = null, granularity = 'day') => ipcRenderer.invoke('sessions:read-requests', filePath, date, granularity),
  readAvatar: filePath => ipcRenderer.invoke('sessions:read-avatar', filePath),
  openSessionFile: filePath => ipcRenderer.invoke('sessions:open-file', filePath),
  onOpenSessionFile: subscribe('sessions:open-file'),
  pathForFile: file => webUtils.getPathForFile(file), // a dropped File's path: the sandboxed renderer can't read it
  onSessionsUpdate: subscribe('sessions:update'),
  onScanProgress: subscribe('sessions:scan-progress'),

  getWorkHours: () => ipcRenderer.invoke('work-hours:get'),
  setWorkHours: data => ipcRenderer.invoke('work-hours:set', data),

  runAgentPrompt: run => ipcRenderer.invoke('agent:run', run),
  onAgentOutput: subscribe('agent:output'),

  checkUpdate: () => ipcRenderer.invoke('auto-update:check'),
  installUpdate: () => ipcRenderer.invoke('auto-update:install'),

  getRateLimits: opts => ipcRenderer.invoke('rate-limits:get', opts),

  openLink: (href, baseFile) => ipcRenderer.invoke('shell:open-link', href, baseFile),

  onFindActive: subscribe('find:active'),
  findClose: () => ipcRenderer.send('find:close'),

  onDeepLink: subscribe('deeplink:open-session'),
  takeDeepLink: () => ipcRenderer.invoke('deeplink:take-pending')
})
