import React, { useMemo } from 'react'
import { format } from 'date-fns'
import { fmtUSD, fmtCompact, fmtDuration } from '../utils/formatting.js'

export default function DailySummary({ sessions, dayAnchor }) {
  const totals = useMemo(() => {
    const workdirs = new Set()
    const t = sessions.reduce((acc, s) => {
      workdirs.add(s.cwd || '(no cwd)')
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

  return (
    <aside className="gantt-side">
      <h2 className="gantt-side-title">{format(dayAnchor, 'EEE, MMM d')}</h2>
      <div className="gantt-side-section">
        <div className="gantt-side-row"><span>Working time</span><b>{fmtDuration(totals.activeMs)}</b></div>
        <div className="gantt-side-row"><span>Total tokens</span><b title={totals.totalTokens.toLocaleString()}>{fmtCompact(totals.totalTokens)}</b></div>
        <div className="gantt-side-row"><span>Estimated cost</span><b>{fmtUSD(totals.cost)}</b></div>
      </div>
      <div className="gantt-side-section">
        <div className="gantt-side-heading">Tokens breakdown</div>
        <div className="gantt-side-row"><span>Input</span><b title={totals.input.toLocaleString()}>{fmtCompact(totals.input)}</b></div>
        <div className="gantt-side-row"><span>Output</span><b title={totals.output.toLocaleString()}>{fmtCompact(totals.output)}</b></div>
        <div className="gantt-side-row"><span>Cache write (5m)</span><b title={totals.cacheCreation5m.toLocaleString()}>{fmtCompact(totals.cacheCreation5m)}</b></div>
        <div className="gantt-side-row"><span>Cache write (1h)</span>{totals.cacheCreation1h > 0 ? <b className="warn-badge" title={totals.cacheCreation1h.toLocaleString()}>{fmtCompact(totals.cacheCreation1h)}</b> : <b>{fmtCompact(totals.cacheCreation1h)}</b>}</div>
        <div className="gantt-side-row"><span>Cache read</span><b title={totals.cacheRead.toLocaleString()}>{fmtCompact(totals.cacheRead)}</b></div>
        <div className="gantt-side-row"><span>Cache hit ratio</span><b>{totals.cacheHitRatio != null ? `${Math.round(totals.cacheHitRatio * 100)}%` : '—'}</b></div>
      </div>
    </aside>
  )
}
