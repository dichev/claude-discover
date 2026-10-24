import { useEffect, useState } from 'react'

const LIVE   = 60_000     // the transcript grew within a minute ("now")
const ACTIVE = 5 * 60_000 // within the parser's activity gap (SessionParser's ACTIVITY_GAP_MS)

// A timeline dot's class: `active live` pulses (styles.css's keyframes), `active` is accent, '' stays gray
export const activity = at => {
  const ago = Date.now() - at
  return ago < LIVE ? 'active live' : ago <= ACTIVE ? 'active' : ''
}

// activity() that re-renders itself when it next changes, instead of polling
export function useActivity(at) {
  const [, rerender] = useState(0)
  const ago  = Date.now() - at
  const next = ago < LIVE ? LIVE - ago : ago <= ACTIVE ? ACTIVE - ago + 1 : null
  useEffect(() => {
    if (next == null) return
    const t = setTimeout(() => rerender(n => n + 1), next)
    return () => clearTimeout(t)
  })
  return activity(at)
}
