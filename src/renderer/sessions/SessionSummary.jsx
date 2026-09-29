import { DollarSign } from 'lucide-react'
import { format } from 'date-fns'
import { fmtDuration, fmtNum, fmtUSD, fmtCompact, fmtToolCalls, tone } from '../utils/formatting.js'
import { THRESHOLDS as T } from '../utils/thresholds.js'
import { contextWindow } from './view/transcript.js'
import AgentOutput from '../agent/AgentOutput.jsx'
import './SessionSummary.css'

export default function SessionSummary({ meta, items, instructions, agent, granularity = 'day' }) {
  const timeFormat = granularity === 'day' ? 'pp' : 'MMM d, pp'
  const t = meta.tokens
  const totalTokens = meta.totalTokens
  const wallDuration = meta.lastActivityAt - meta.startedAt
  const activeDuration = meta.activeMs
  const cost = meta.cost
  const cacheHitRatio = meta.cacheHitRatio
  const stu = meta.serverToolUse
  const hasServerTools = stu.webSearch > 0 || stu.webFetch > 0
  const modelLabel = meta.models.join(', ') || '—'
  const ctxLimit = contextWindow(meta.models)
  const ctxTone = tone(meta.lastContextTokens, T.context)

  return (
    <div className="session-summary">
      <div className="summary-ai">
        <button
          type="button"
          className="button-primary summary-ai-button"
          onClick={() => agent.analyze(meta, items, instructions)}
          disabled={agent.running || !items}
        >
          <span className={agent.running ? 'hidden' : ''}>⚡︎ AI Analyze</span>
          <span className={agent.running ? '' : 'hidden'}>⚡︎ Analyzing…</span>
        </button>
        <AgentOutput output={agent.output} running={agent.running} error={agent.error} />
      </div>

      <Section title="Summary">
        <Field label="Estimated cost" value={
          <>
            {meta.priceUnknown && <span className="danger-badge" title={`No price entry for ${modelLabel} — cost is missing or understated`}><DollarSign size={11} /></span>}
            <span className={tone(cost, T.cost)}>{fmtUSD(cost)}</span>
          </>
        } />
        <Field label="Total tokens" value={<span className={tone(totalTokens, T.tokens)}>{fmtCompact(totalTokens)}</span>} />
        <Field label="Working time" value={<span className={tone(activeDuration, T.workTime)}>{fmtDuration(activeDuration)}</span>} />
        <Field label="Context size" value={
          <span className={ctxTone}>{`${fmtCompact(meta.lastContextTokens)} / ${fmtCompact(ctxLimit)}`}</span>
        } below={
          <Bar ratio={meta.lastContextTokens / ctxLimit} tone={ctxTone} />
        }/>
      </Section>

      {meta.savings.using5mCache > 0 && (
        <Section title="Potential savings">
          <Field
            label={<>{cost > 0 && <strong>-{(meta.savings.using5mCache / cost * 100).toFixed(0)}% </strong>}with 5m cache</>}
            value={`−${fmtUSD(meta.savings.using5mCache)}`}
          />
        </Section>
      )}

      <Section title="Tokens">
        <Field label="Input" value={fmtNum(t.input)} />
        <Field label="Output" value={fmtNum(t.output)} />
        <Field label="Cache write (5m)" value={fmtNum(t.cacheCreation5m || 0)} />
        <Field
          label="Cache write (1h)"
          value={<span className={t.cacheCreation1h > 0 ? 'warn' : ''}>{fmtNum(t.cacheCreation1h || 0)}</span>}
        />

        <Field label="Cache read" value={fmtNum(t.cacheRead)} />
        <Field label="Cache hit ratio" value={`${(cacheHitRatio * 100).toFixed(0)}%`} />
        {hasServerTools && (
          <Field
            label="Server tools (search / fetch)"
            value={`${fmtNum(stu.webSearch)} / ${fmtNum(stu.webFetch)}`}
          />
        )}
      </Section>

      <Section title="Activity">
        <Field label="Started" value={format(meta.startedAt, timeFormat)} />
        <Field label="Last activity" value={format(meta.lastActivityAt, timeFormat)} />
        <Field label="Wall duration" value={fmtDuration(wallDuration)} />
        <Field label="Active periods" value={fmtNum(meta.activityPeriods.length)} />
        <Field label="Messages" value={
          <span className={tone(meta.messageCount, T.messages)}>{fmtNum(meta.messageCount)}</span>
        } />
        <Field label="Tool calls" value={fmtToolCalls(meta)} />
      </Section>

      <Section title="Identity">
        <Field label="Session ID" value={<span className="session-id">{meta.sessionId}</span>} mono full autoselect />        <Field label="Model" value={modelLabel} mono />
        {meta.efforts.length > 0 && <Field label="Effort" value={meta.efforts.join(', ')} />}
        {meta.serviceTier && <Field label="Service tier" value={meta.serviceTier} />}
        {meta.speed && <Field label="Speed" value={meta.speed === 'fast' ? (meta.fastPricingUnknown ? 'fast (pricing unknown)' : 'fast') : meta.speed} />}
        {meta.tag && <Field label="Tag" value={meta.tag} mono />}
        <Field label="Git branch" value={meta.gitBranch || '—'} mono />
        <Field label="Source" value={meta.source || meta.entrypoint || '—'} />
        {meta.hasScheduledTask && <Field label="Scheduled" value="yes" />}
        <Field label="CLI version" value={meta.version || '—'} mono />
        <Field label="Project" value={meta.project || '—'} mono full autoselect />
        {meta.worktreePath && <Field label="Worktree" value={meta.worktreePath} mono full autoselect />}
        <Field label="Log file" value={meta.filePath} mono full autoselect />      </Section>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="summary-section">
      <div className="summary-section-title">{title}</div>
      {children}
    </div>
  )
}

function Bar({ ratio, tone }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <div className={`progress-bar tone-${tone}`}>
      <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

function Field({ label, value, mono, full, below, autoselect }) {
  const selectAll = autoselect ? (e) => {
    const range = document.createRange()
    range.selectNodeContents(e.currentTarget)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  } : undefined

  if (below) {
    return (
      <div className="field has-below">
        <div className="field-row">
          <div className="field-label">{label}</div>
          <div className={`field-value ${mono ? 'mono' : ''}`} onClick={selectAll}>{value}</div>
        </div>
        {below}
      </div>
    )
  }
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <div className="field-label">{label}</div>
      <div className={`field-value ${mono ? 'mono' : ''}`} onClick={selectAll}>{value}</div>
    </div>
  )
}
