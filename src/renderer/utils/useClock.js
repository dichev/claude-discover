import { useSyncExternalStore } from 'react'

// One shared 10s clock: `read` derives a value from Date.now(), and the caller re-renders only
// when that value changes — so a list of relative times doesn't re-render every row on each tick.
const listeners = new Set()
let timer = null

const subscribe = cb => {
  listeners.add(cb)
  timer ??= setInterval(() => listeners.forEach(l => l()), 10_000)
  return () => {
    listeners.delete(cb)
    if (listeners.size) return
    clearInterval(timer)
    timer = null
  }
}

export const useClock = read => useSyncExternalStore(subscribe, read)
