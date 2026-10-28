import { format } from 'date-fns'
import { endOfPeriod, isSamePeriod } from '../utils/period.js'
import { useClock } from '../utils/useClock.js'
import { SOURCE_COLORS, SOURCE_LABELS, SOURCE_ORDER } from '../utils/colors.js'
import './Toolbar.css'

const GRANULARITIES = [
  { key: 'day', label: 'Daily' },
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
]

const RESET_LABELS = { day: 'Today', week: 'This week', month: 'This month' }

const sourceRank = k => { const i = SOURCE_ORDER.indexOf(k); return i === -1 ? SOURCE_ORDER.length : i }

function periodTitle(anchor, granularity) {
  if (granularity === 'week') return `${format(anchor, 'MMM d')} – ${format(endOfPeriod(anchor, 'week'), 'MMM d')}`
  if (granularity === 'month') return format(anchor, 'MMMM yyyy')
  return format(anchor, 'EEE, MMM d')
}

export default function Toolbar({
  granularity, onSetGranularity, dayAnchor, onShiftDay, onResetToday,
  sourceFilter, availableSources, onToggleSourceFilter,
}) {
  const onToday = useClock(() => isSamePeriod(dayAnchor, Date.now(), granularity))

  return (
    <div className="gantt-toolbar">
      <h2 className="section-title-text">Activity Timeline</h2>
      <div className="gantt-toolbar-nav">
        <button className="gantt-nav-arrow" onClick={() => onShiftDay?.(-1)} data-tooltip-content="Previous period" aria-label="Previous period">‹</button>
        <h2 className="gantt-toolbar-title">{periodTitle(dayAnchor, granularity)}</h2>
        <button
          className="gantt-nav-arrow"
          onClick={() => onShiftDay?.(1)}
          style={{ visibility: onToday ? 'hidden' : 'visible' }}
          data-tooltip-content="Next period"
          aria-label="Next period"
        >›</button>
        <button
          className="gantt-toolbar-today"
          onClick={onResetToday}
          style={{ visibility: onToday ? 'hidden' : 'visible' }}
        >{RESET_LABELS[granularity]}</button>
      </div>
      <div className="gantt-toolbar-end">
        <div className="gantt-legend">
          {availableSources.toSorted((a, b) => sourceRank(a) - sourceRank(b)).map(k => {
            const active = sourceFilter === k
            const dim = sourceFilter && !active
            return (
              <button key={k} type="button" className={`legend-chip ${active ? 'filter-active' : ''} ${dim ? 'dim' : ''}`} onClick={() => onToggleSourceFilter(k)}>
                <span className="swatch" style={{ background: SOURCE_COLORS[k] || SOURCE_COLORS.other }} />
                {SOURCE_LABELS[k] || k}
              </button>
            )
          })}
        </div>
        <div className="gantt-granularity" role="tablist">
          {GRANULARITIES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={granularity === key}
              className={granularity === key ? 'active' : ''}
              onClick={() => onSetGranularity?.(key)}
            >{label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
