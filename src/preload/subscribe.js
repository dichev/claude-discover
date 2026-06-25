import { ipcRenderer } from 'electron'

// Subscribe to an IPC channel; returns an unsubscribe fn. Shared by both preload entries.
export const subscribe = channel => cb => {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}
