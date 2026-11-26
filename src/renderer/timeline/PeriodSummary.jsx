import { Fragment, useState } from 'react'
import { fmtUSD, fmtCompact, fmtDuration, plural } from '../utils/formatting.js'
import { CACHE_LABELS } from '../utils/cacheAdvice.js'
import { sumTotals, tokenMix, groupByProject } from './periodTotals.js'
import CostBreakdownChart from './CostBreakdownChart.jsx'
import './PeriodSummary.css'

export default function PeriodSummary({ sessions, dayAnchor, granularity = 'day', expanded }) {
  const totals = sumTotals(sessions)

  const byProject = groupByProject(sessions)

  const [stat, setStat] = useState('cost')
  const isCost = stat === 'cost'

  const byStat = (a, b) => isCost ? b.cost - a.cost : b.totalTokens - a.totalTokens
  const sortedByProject = byProject.toSorted(byStat)

  const mix = tokenMix(totals).map(m => ({ ...m, value: m[stat] || 0 }))
  const mixTotal = mix.reduce((sum, m) => sum + m.value, 0)

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
        {(totals.cacheSavings.length > 0 || totals.advisor.cost > 0) && (
          <div className="gantt-side-section">
            <div className="gantt-side-heading">Potential savings</div>
            {totals.cacheSavings.map(([policy, saving]) => (
              <div key={policy} className="gantt-side-row"><span><strong>-{(saving / totals.cost * 100).toFixed(0)}% </strong>{CACHE_LABELS[policy]}</span><b>−{fmtUSD(saving)}</b></div>
            ))}
            {totals.advisor.cost > 0 && (
              <div className="gantt-side-row">
                <span data-tooltip-content={`${plural(totals.advisor.calls, 'advisor call')}, billed apart on a second model\nTurn it off with /advisor off`}>
                  <strong>-{(totals.advisor.cost / totals.cost * 100).toFixed(0)}% </strong>Advisor
                </span>
                <b>−{fmtUSD(totals.advisor.cost)}</b>
              </div>
            )}
          </div>
        )}
        {mixTotal > 0 && (
          <div className="gantt-side-section">
            <div className="gantt-side-heading">
              {isCost ? 'Tokens (cost)' : 'Tokens'}
              {totals.cacheHitRatio != null && <span className="gantt-side-heading-note">{Math.round(totals.cacheHitRatio * 100)}% cache hit</span>}
            </div>
            <div className="token-mix-bar" role="img" aria-label={mix.map(m => `${m.label} ${Math.round(m.value / mixTotal * 100)}%`).join(', ')}>
              {mix.filter(m => m.value > 0).map(m => (
                <div key={m.label} style={{ flexGrow: m.value / mixTotal, background: m.color }} data-tooltip-content={`${m.label} · ${(m.value / mixTotal * 100).toFixed(1)}%`} />
              ))}
            </div>
            <div className="token-mix-legend">
              {mix.map(m => (
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
