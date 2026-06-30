import { useSyncExternalStore } from 'react'

// Module-level store tracking whether the native find bar is open (no context/provider).
// The transcript views (ConversationView, JsonlView) read it and pass it to LazyMount as
// forceMount, so findInPage can match content that hasn't been scrolled into view yet.
// Subscribed once at import; the store lives for the app's lifetime.
let active = false
const listeners = new Set()

const setActive = v => {
  if (v === active) return // also dedupes the echo of our own optimistic closeFind()
  active = v
  listeners.forEach(l => l())
}
window.api.onFindActive(setActive)

const subscribe = cb => { listeners.add(cb); return () => listeners.delete(cb) }
export function useFindActive() {
  return useSyncExternalStore(subscribe, () => active)
}

// Clear the store synchronously (not waiting for the IPC echo) so a session switch beats the mount-all race
export function closeFind() {
  if (!active) return
  setActive(false)
  window.api.findClose()
}
