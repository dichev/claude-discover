import React from 'react'
import { format } from 'date-fns'
import './TimeAxis.css'

function minorIntervalFor(span) {
  if (span < 15 * 60_000)   return 60_000        // < 15 min  → 1 min
  if (span < 60 * 60_000)   return 5 * 60_000    // < 1 h     → 5 min
  if (span < 3 * 3600_000)  return 10 * 60_000   // < 3 h     → 10 min
  if (span < 12 * 3600_000) return 30 * 60_000   // < 12 h    → 30 min
  return null
}

// Pure: returns the tick positions [{ x, label, major }] for the current view.
// GanttChart uses these to draw the grid; TimeAxis renders the header marks + labels.
export function computeTicks({ viewStart, viewEnd, width, span }) {
  // Wide (week / month) spans: tick once per day instead of ~720 hourly lines.
  if (span > 2 * 86400_000) {
    const ticks = []
    const d = new Date(viewStart)
    d.setHours(0, 0, 0, 0)
    if (d.getTime() < viewStart) d.setDate(d.getDate() + 1)
    for (let t = d.getTime(); t <= viewEnd; d.setDate(d.getDate() + 1), t = d.getTime()) {
      ticks.push({ x: ((t - viewStart) / span) * width, label: format(t, 'MMM d'), major: true })
    }
    return ticks
  }

  const step = minorIntervalFor(span) ?? 3600_000
  const intervalMin = step / 60_000

  const t0 = new Date(viewStart)
  t0.setSeconds(0, 0)
  t0.setMinutes(t0.getMinutes() - (t0.getMinutes() % intervalMin))
  if (t0.getTime() < viewStart) t0.setMinutes(t0.getMinutes() + intervalMin)

  const ticks = []
  for (let t = t0.getTime(); t <= viewEnd; t += step) {
    const d = new Date(t)
    const major = d.getMinutes() === 0
    const label = major ? String(d.getHours()).padStart(2, '0') : `:${String(d.getMinutes()).padStart(2, '0')}`
    ticks.push({ x: ((t - viewStart) / span) * width, label, major })
  }
  return ticks
}

export default function TimeAxis({ viewStart, viewEnd, width, span, headerHeight }) {
  const ticks = computeTicks({ viewStart, viewEnd, width, span })
  return (
    <g className="ticks">
      {ticks.map((tk, i) => (
        <g key={i} transform={`translate(${tk.x},0)`}>
          <line y1={0} y2={headerHeight} className={`tick-hline ${tk.major ? 'tick-major' : 'tick-minor'}`} />
          <text x={4} y={14} className={`tick-text ${tk.major ? 'tick-major' : 'tick-minor'}`}>{tk.label}</text>
        </g>
      ))}
    </g>
  )
}
