import React from 'react'
import { isSamePeriod, periodLabel } from '../utils/period.js'
import { SOURCE_COLORS, SOURCE_LABELS, SOURCE_ORDER } from '../utils/colors.js'
import './Toolbar.css'

const GRANULARITIES = [
  { key: 'day', label: 'Daily' },
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
]

export default function Toolbar({
  granularity, onSetGranularity, dayAnchor, onShiftDay, onResetToday,
  sourceFilter, availableSources, onToggleSourceFilter,
}) {
  return (
    <div className="gantt-toolbar">
      <div className="gantt-granularity">
        {GRANULARITIES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`gantt-granularity-btn${granularity === key ? ' active' : ''}`}
            onClick={() => onSetGranularity?.(key)}
          >{label}</button>
        ))}
      </div>
      <div className="gantt-pill-wrap">
        <div className="gantt-controls">
          <button className="gantt-nav-btn" onClick={() => onShiftDay(-1)} title="Previous period" aria-label="Previous period">←</button>
          <span className="gantt-date-label">{periodLabel(dayAnchor, granularity)}</span>
          <button
            className="gantt-nav-btn"
            onClick={() => onShiftDay(1)}
            title="Next period"
            aria-label="Next period"
            style={{ visibility: isSamePeriod(dayAnchor, Date.now(), granularity) ? 'hidden' : 'visible' }}
          >→</button>
        </div>
        <button
          className="gantt-today-btn"
          onClick={onResetToday}
          style={{ visibility: isSamePeriod(dayAnchor, Date.now(), granularity) ? 'hidden' : 'visible' }}
        >Today</button>
      </div>
      <div className="gantt-legend">
        {(availableSources ?? []).slice().sort((a, b) => {
          const ia = SOURCE_ORDER.indexOf(a), ib = SOURCE_ORDER.indexOf(b)
          return (ia === -1 ? SOURCE_ORDER.length : ia) - (ib === -1 ? SOURCE_ORDER.length : ib)
        }).map((k) => {
          const active = sourceFilter === k
          const dim = sourceFilter && !active
          return (
            <button key={k} type="button" className={`legend-chip ${active ? 'active' : ''} ${dim ? 'dim' : ''}`} onClick={() => onToggleSourceFilter?.(k)}>
              <span className="swatch" style={{ background: SOURCE_COLORS[k] || SOURCE_COLORS.other }} />
              {SOURCE_LABELS[k] || k}
            </button>
          )
        })}
      </div>
    </div>
  )
}
