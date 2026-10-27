import { useClock } from './useClock.js'

const LIVE   = 60_000     // the transcript grew within a minute ("now")
const ACTIVE = 5 * 60_000 // within the parser's activity gap (SessionParser's ACTIVITY_GAP_MS)

// A timeline dot's class: `active live` pulses (styles.css's keyframes), `active` is accent, '' stays gray
export const activity = (at, now) => {
  const ago = now - at
  return ago < LIVE ? 'active live' : ago <= ACTIVE ? 'active' : ''
}

// The last moment any of these dots changed class: a `now` that gives activity() the same answers as the
// real one, but changes only with them — so a clock reading it re-renders (and refreshes cached JSX) just then
export const lastChange = ats => Math.max(0, ...ats.flatMap(at => [at + LIVE, at + ACTIVE + 1]).filter(t => t <= Date.now()))

export const useActivity = at => activity(at, useClock(() => lastChange([at])))
