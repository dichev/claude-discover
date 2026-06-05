import React, { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { endOfPeriod } from '../utils/period.js'
import { fmtUSD, fmtCompact, fmtDuration } from '../utils/formatting.js'
import { groupByRoot } from '../utils/grouping.js'
import './PeriodSummary.css'

function periodTitle(anchor, granularity) {
  if (granularity === 'week') return `${format(anchor, 'MMM d')} – ${format(endOfPeriod(anchor, 'week'), 'MMM d')}`
  if (granularity === 'month') return format(anchor, 'MMMM yyyy')
  return format(anchor, 'EEE, MMM d')
}

export default function PeriodSummary({ sessions, dayAnchor, granularity = 'day' }) {
  const totals = useMemo(() => {
    const t = sessions.reduce((acc, s) => {
      acc.cost += s.cost || 0
      acc.totalTokens += s.totalTokens || 0
      acc.input += s.tokens.input
      acc.output += s.tokens.output
      acc.cacheRead += s.tokens.cacheRead
      acc.cacheCreation += s.tokens.cacheCreation
      acc.cacheCreation5m += s.tokens.cacheCreation5m || 0
      acc.cacheCreation1h += s.tokens.cacheCreation1h || 0
      acc.activeMs += s.activeMs || 0
      return acc
    }, { cost: 0, totalTokens: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cacheCreation5m: 0, cacheCreation1h: 0, activeMs: 0 })
    const cacheDenom = t.cacheRead + t.cacheCreation
    t.cacheHitRatio = cacheDenom > 0 ? t.cacheRead / cacheDenom : null
    return t
  }, [sessions])

  const byProject = useMemo(() => {
    const map = new Map()
    for (const s of sessions) {
      const key = s.project || '(no project)'
      let g = map.get(key)
      if (!g) {
        g = { key, root: s.projectRoot || key, rootShort: s.projectRootShort, projectShort: s.projectShort, cost: 0, totalTokens: 0 }
        map.set(key, g)
      }
      g.cost += s.cost || 0
      g.totalTokens += s.totalTokens || 0
    }
    return [...map.values()]
  }, [sessions])

  const [projectStat, setProjectStat] = useState('cost')

  const sortedByProject = useMemo(() =>
    groupByRoot(byProject, projectStat === 'cost' ? g => g.cost : g => g.totalTokens),
    [byProject, projectStat]
  )

  return (
    <aside className="gantt-side">
      <h2 className="gantt-side-title">{periodTitle(dayAnchor, granularity)}</h2>
      <div className="gantt-side-section">
        <div className="gantt-side-row"><span>Working time</span><b>{fmtDuration(totals.activeMs)}</b></div>
        <div className="gantt-side-row"><span>Total tokens</span><b>{fmtCompact(totals.totalTokens)}</b></div>
        <div className="gantt-side-row"><span>Estimated cost</span><b>{fmtUSD(totals.cost)}</b></div>
      </div>
      {sortedByProject.length > 0 && (
        <div className="gantt-side-section">
          <div className="gantt-side-heading">
            By project
            <button
              className="stats-toggle"
              onClick={() => setProjectStat((v) => v === 'cost' ? 'tokens' : 'cost')}
              title={`Showing ${projectStat} — click to toggle`}
            >{projectStat === 'cost' ? 'T' : '$'}</button>
          </div>
          {sortedByProject.map((g) => (
            <div key={g.key} className={`gantt-side-row${g.key !== g.root ? ' gantt-side-row-worktree' : ''}`}>
              <span title={g.key}>{g.key !== g.root ? `- ${g.projectShort}` : g.projectShort}</span>
              {!g.header && <b>{projectStat === 'cost' ? fmtUSD(g.cost) : fmtCompact(g.totalTokens)}</b>}
            </div>
          ))}
        </div>
      )}
      <div className="gantt-side-section">
        <div className="gantt-side-heading">Tokens breakdown</div>
        <div className="gantt-side-row"><span>Input</span><b>{fmtCompact(totals.input)}</b></div>
        <div className="gantt-side-row"><span>Output</span><b>{fmtCompact(totals.output)}</b></div>
        <div className="gantt-side-row"><span>Cache write (5m)</span><b>{fmtCompact(totals.cacheCreation5m)}</b></div>
        <div className="gantt-side-row"><span>Cache write (1h)</span>{totals.cacheCreation1h > 0 ? <b className="warn-badge">{fmtCompact(totals.cacheCreation1h)}</b> : <b>{fmtCompact(totals.cacheCreation1h)}</b>}</div>
        <div className="gantt-side-row"><span>Cache read</span><b>{fmtCompact(totals.cacheRead)}</b></div>
        <div className="gantt-side-row"><span>Cache hit ratio</span><b>{totals.cacheHitRatio != null ? `${Math.round(totals.cacheHitRatio * 100)}%` : '—'}</b></div>
      </div>
    </aside>
  )
}
