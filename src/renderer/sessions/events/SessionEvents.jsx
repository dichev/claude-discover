import { useEffect, useRef } from 'react'
import './SessionEvents.css'

// The conversation's events (see sessionEvents) on a dot line like the session list's, `picked` marked; `onJump` scrolls the
// conversation to the one clicked
export default function SessionEvents({ events, picked, onJump }) {
  const listRef = useRef(null)

  // Keep the picked event in view as the conversation scrolls, scrolling only the list, not the Summary around it
  useEffect(() => {
    listRef.current.querySelector('.picked')?.scrollIntoView({ block: 'nearest', container: 'nearest' })
  }, [picked])

  return (
    <div className="session-events" ref={listRef}>
      {events.map((e, i) => (
        <div key={i} className={`session-event ${e === picked ? 'picked' : ''}`} onClick={() => onJump(e)}>
          <span className="session-event-dot" />
          <span className="session-event-name">{e.name}{e.note && ` (${e.note})`}</span>
          <span className="session-event-time">{e.time}</span>
        </div>
      ))}
    </div>
  )
}

// The arrows that jump to the events before and after the row scrolled to (see eventsAt), for the section's title.
export function EventStep({ earlier, later, onJump }) {
  return (
    <span className="session-events-step">
      <button type="button" aria-label="Earlier event" disabled={!earlier} onClick={() => onJump(earlier)}>‹</button>
      <button type="button" aria-label="Later event" disabled={!later} onClick={() => onJump(later)}>›</button>
    </span>
  )
}
