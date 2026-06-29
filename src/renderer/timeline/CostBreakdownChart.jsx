import { useMemo } from 'react'
import { format, addHours, addDays, startOfMonth, getDaysInMonth } from 'date-fns'
import { startOfPeriod } from '../utils/period.js'
import { fmtUSD } from '../utils/formatting.js'
import './CostBreakdownChart.css'

const BAR_MAX_PX = 52

// Cost over time: hourly (daily view), or daily (weekly/monthly view) buckets.
export default function CostBreakdownChart({ sessions, dayAnchor, granularity }) {
  const { bs, max } = useMemo(() => {
    const start = startOfPeriod(dayAnchor, granularity)
    let bs
    if (granularity === 'month') {
      const monthStart = startOfMonth(start)
      bs = Array.from({ length: getDaysInMonth(monthStart) }, (_, i) => ({ start: +addDays(monthStart, i), label: format(addDays(monthStart, i), 'd'), tip: format(addDays(monthStart, i), 'MMM d'), showLabel: i % 5 === 0 }))
    } else if (granularity === 'week') {
      bs = Array.from({ length: 7 }, (_, i) => ({ start: +addDays(start, i), label: format(addDays(start, i), 'EEEEE'), tip: format(addDays(start, i), 'MMM d'), showLabel: true }))
    } else {
      bs = Array.from({ length: 24 }, (_, i) => ({ start: +addHours(start, i), label: String(i).padStart(2, '0'), tip: `${i}h`, showLabel: i % 6 === 0 }))
    }
    for (const b of bs) b.cost = 0
    for (const s of sessions) {
      for (const sample of s.costSamples ?? []) {
        let i = bs.length - 1
        while (i > 0 && bs[i].start > sample.start) i--
        bs[i].cost += sample.cost || 0
      }
    }
    return { bs, max: Math.max(0, ...bs.map((b) => b.cost)) }
  }, [sessions, dayAnchor, granularity])

  if (max <= 0) return null

  return (
    <div className="cost-chart">
      <div className="cost-chart-cols">
        {bs.map((b, i) => (
          <div key={i} className="cost-chart-col" title={`${b.tip} · ${fmtUSD(b.cost)}`} data-tippy-placement="bottom">
            <div className="cost-chart-cell">
              <div className="cost-chart-bar" style={{ height: `${b.cost > 0 ? Math.max(1, Math.round((b.cost / max) * BAR_MAX_PX)) : 0}px` }} />
            </div>
            <span className="cost-chart-label">{b.showLabel ? b.label : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
