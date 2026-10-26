import { useSyncExternalStore } from 'react'

// Module-level store for the period scan's progress, so its frequent events re-render only
// what reads them (the StatusBar), not App and the whole month under it.
// Subscribed once at import, so no event is missed before a reader mounts.
let progress = null
const listeners = new Set()

const setProgress = p => {
  progress = p
  listeners.forEach(l => l())
}
window.api.onScanProgress(setProgress)

const subscribe = cb => { listeners.add(cb); return () => listeners.delete(cb) }
export function useScanProgress(select = p => p) {
  return useSyncExternalStore(subscribe, () => select(progress))
}

export const resetScanProgress = () => setProgress(null) // a fresh scan for a new period
