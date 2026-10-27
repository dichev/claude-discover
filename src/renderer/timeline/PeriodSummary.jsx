import { Fragment, useState } from 'react'
import { fmtUSD, fmtCompact, fmtDuration } from '../utils/formatting.js'
import { cheaperCache, CACHE_LABELS } from '../utils/cacheAdvice.js'
import { THRESHOLDS as T } from '../utils/thresholds.js'
import CostBreakdownChart from './CostBreakdownChart.jsx'
import './PeriodSummary.css'

function sumTotals(sessions) {
  const t = sessions.reduce((acc, s) => {
    acc.cost += s.cost || 0
    const cheaper = cheaperCache(s) // every session's, so many small savings still add up
    if (cheaper) acc.cacheSavings[cheaper.policy] = (acc.cacheSavings[cheaper.policy] || 0) + cheaper.saving
    acc.totalTokens += s.totalTokens || 0
    acc.input += s.tokens.input
    acc.output += s.tokens.output
    acc.cacheRead += s.tokens.cacheRead
    acc.cacheCreation += s.tokens.cacheCreation
    acc.cacheCreation1h += s.tokens.cacheCreation1h || 0
    for (const k in s.costByType) acc.costByType[k] = (acc.costByType[k] || 0) + s.costByType[k]
    acc.activeMs += s.activeMs || 0
    return acc
  }, { cost: 0, cacheSavings: {}, totalTokens: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cacheCreation1h: 0, activeMs: 0, costByType: {} })
  const cacheDenom = t.cacheRead + t.cacheCreation
  t.cacheHitRatio = cacheDenom > 0 ? t.cacheRead / cacheDenom : null
  t.cacheSavings = Object.entries(t.cacheSavings).filter(([, saving]) => saving > T.cacheSaving.min)
  return t
}

function groupByProject(sessions) {
  const map = new Map()
  for (const s of sessions) {
    const key = s.project || '(no project)'
    let g = map.get(key)
    if (!g) {
      g = { key, projectShort: s.projectShort, cost: 0, totalTokens: 0, byDir: new Map() }
      map.set(key, g)
    }
    const dir = s.subdir ?? ''
    let d = g.byDir.get(dir)
    if (!d) g.byDir.set(dir, d = { dir, cost: 0, totalTokens: 0 })
    for (const t of [g, d]) {
      t.cost += s.cost || 0
      t.totalTokens += s.totalTokens || 0
    }
  }
  return [...map.values()]
}

export default function PeriodSummary({ sessions, dayAnchor, granularity = 'day', expanded }) {
  const totals = sumTotals(sessions)

  const byProject = groupByProject(sessions)

  const [stat, setStat] = useState('cost')
  const isCost = stat === 'cost'

  const byStat = (a, b) => isCost ? b.cost - a.cost : b.totalTokens - a.totalTokens
  const sortedByProject = byProject.toSorted(byStat)

  const c = totals.costByType
  const tokenMix = [
    { label: 'Cache read', tokens: totals.cacheRead, cost: c.cacheRead, color: '#3b4a63' },
    { label: 'Cache write', tokens: totals.cacheCreation - totals.cacheCreation1h, cost: c.cacheWrite, color: '#d97706' },
    totals.cacheCreation1h > 0 && { label: 'Cache write (1h)', tokens: totals.cacheCreation1h, cost: c.cacheWrite1h, color: 'var(--warn)' },
    { label: 'Output', tokens: totals.output, cost: c.output, color: 'var(--accent)' },
    { label: 'Input', tokens: totals.input, cost: c.input, color: '#ddd6fe' },
  ].filter(Boolean).map(m => ({ ...m, value: m[stat] || 0 }))
  const mixTotal = tokenMix.reduce((sum, m) => sum + m.value, 0)

  return (
    <aside className="gantt-side">
      <div className="gantt-side-head">
        <div className="summary-label">Period Summary</div>
        <div className="period-total-head">
          <div className="period-total-cost">{isCost ? fmtUSD(totals.cost) : fmtCompact(totals.totalTokens)}</div>
          <div className="stat-switch" role="group" aria-label="Show">
            <button type="button" aria-pressed={isCost} aria-label="Cost" onClick={() => setStat('cost')}>$</button>
            <button type="button" aria-pressed={!isCost} aria-label="Tokens" onClick={() => setStat('tokens')}>T</button>
          </div>
        </div>
      </div>
      <div className="gantt-side-body">
        <div className="gantt-side-section">
          {(isCost ? totals.cost : totals.totalTokens) > 0 && (
            <CostBreakdownChart sessions={sessions} dayAnchor={dayAnchor} granularity={granularity} stat={stat} />
          )}
          {isCost
            ? <div className="gantt-side-row"><span>Total tokens</span><b>{fmtCompact(totals.totalTokens)}</b></div>
            : <div className="gantt-side-row"><span>Estimated cost</span><b>{fmtUSD(totals.cost)}</b></div>}
          <div className="gantt-side-row"><span>Working time</span><b>{fmtDuration(totals.activeMs)}</b></div>
        </div>
        {totals.cacheSavings.length > 0 && (
          <div className="gantt-side-section">
            <div className="gantt-side-heading">Potential savings</div>
            {totals.cacheSavings.map(([policy, saving]) => (
              <div key={policy} className="gantt-side-row"><span><strong>-{(saving / totals.cost * 100).toFixed(0)}% </strong>{CACHE_LABELS[policy]}</span><b>−{fmtUSD(saving)}</b></div>
            ))}
          </div>
        )}
        {mixTotal > 0 && (
          <div className="gantt-side-section">
            <div className="gantt-side-heading">
              {isCost ? 'Tokens (cost)' : 'Tokens'}
              {totals.cacheHitRatio != null && <span className="gantt-side-heading-note">{Math.round(totals.cacheHitRatio * 100)}% cache hit</span>}
            </div>
            <div className="token-mix-bar" role="img" aria-label={tokenMix.map(m => `${m.label} ${Math.round(m.value / mixTotal * 100)}%`).join(', ')}>
              {tokenMix.filter(m => m.value > 0).map(m => (
                <div key={m.label} style={{ flexGrow: m.value / mixTotal, background: m.color }} data-tooltip-content={`${m.label} · ${(m.value / mixTotal * 100).toFixed(1)}%`} />
              ))}
            </div>
            <div className="token-mix-legend">
              {tokenMix.map(m => (
                <div key={m.label} className="token-mix-item">
                  <span className="token-mix-swatch" style={{ background: m.color }} />
                  <span>{m.label}</span>
                  <b>{isCost ? fmtUSD(m.value) : fmtCompact(m.value)}</b>
                </div>
              ))}
            </div>
          </div>
        )}
        {sortedByProject.length > 0 && (
          <div className="gantt-side-section">
            <div className="gantt-side-heading">By project</div>
            {sortedByProject.map(g => (
              <Fragment key={g.key}>
                <div className="gantt-side-row">
                  <span>{g.projectShort}</span>
                  <b>{isCost ? fmtUSD(g.cost) : fmtCompact(g.totalTokens)}</b>
                </div>
                {expanded.includes(g.key) && g.byDir.size - g.byDir.has('') > 0 && [...g.byDir.values()].sort(byStat).map(d => (
                  <div key={d.dir} className="gantt-side-row gantt-side-subrow">
                    <span data-tooltip-content={d.dir || undefined}>{d.dir || '(root)'}</span>
                    <b>{isCost ? fmtUSD(d.cost) : fmtCompact(d.totalTokens)}</b>
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
