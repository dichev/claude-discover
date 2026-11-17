import { DollarSign, WandSparkles } from 'lucide-react'
import { format } from 'date-fns'
import { fmtDuration, fmtNum, fmtUSD, fmtCompact, fmtToolCalls, plural, tone } from '../utils/formatting.js'
import { THRESHOLDS as T } from '../utils/thresholds.js'
import { cacheAdvice, CACHE_LABELS } from '../utils/cacheAdvice.js'
import { contextWindow, contextTokens } from './view/transcript.js'
import { contextAt, contextParts, rowUntil } from './context/contextParts.js'
import { totalsBy } from './context/totalsBy.js'
import ContextUsage, { ContextFill, ContextInfo } from './context/ContextUsage.jsx'
import SessionEvents, { EventStep } from './events/SessionEvents.jsx'
import { eventsAt } from './events/sessionEvents.js'
import { EXPERIMENT_TIP } from './view/labels.js'
import AgentOutput from '../agent/AgentOutput.jsx'
import './SessionSummary.css'

export default function SessionSummary({ meta, items, turns, events, instructions, requestLog, debugLog, agent, at, onJump, granularity = 'day' }) {
  const timeFormat = granularity === 'day' ? 'pp' : 'MMM d, pp'
  const wallDuration = meta.lastActivityAt - meta.startedAt
  const cost = meta.cost
  const hasServerTools = meta.serverToolUse.webSearch > 0 || meta.serverToolUse.webFetch > 0
  const modelLabel = meta.models.join(', ') || '—'
  const advice = cacheAdvice(meta)
  const advisor = meta.advisor
  const ctxLimit = contextWindow(meta.models)
  const ctx = contextTokens(meta, instructions)
  // Counted in the loaded period's transcript (`turns`, flattened from `items`), like the Conversation view
  const rewinds = turns.filter(t => t.rewind).length
  const compactions = turns.filter(t => t.role === 'compact').length
  const sofar = totalsBy(meta, at == null ? null : rowUntil(turns, at)) // the Summary and Tokens figures by the row the context is shown at
  const t = sofar.tokens
  const stu = sofar.serverToolUse
  // The context at the row scrolled to (see contextAt), else now: a guess until the reply after a compaction
  const read  = at != null && contextAt(turns, at)
  const point = read || { turns, size: ctx }
  const parts = contextParts(point.turns, point.size)
  const rough = meta.contextCompacted && !read
  const { picked, earlier, later } = eventsAt(turns, events, at)

  const busy = agent.running || !items
  const ask = e => {
    e.preventDefault()
    const question = e.currentTarget.elements.question.value.trim()
    if (question) agent.ask(question)
  }

  return (
    <div className="session-summary">
      <div className="summary-head">
        <div className="summary-label">Session Analyze</div>
        <form className="summary-ask" onSubmit={ask}>
          <textarea
            name="question"
            rows={3}
            placeholder="Ask anything about this session…"
            disabled={busy}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form.requestSubmit()
              }
            }}
          />
          <button type="submit" className="button-primary" disabled={busy}><WandSparkles size={12} /> Ask</button>
        </form>
        <div className="summary-ask-presets">
          <button type="button" onClick={() => agent.analyze()} disabled={busy}>How to optimize?</button>
          <button type="button" onClick={() => agent.diagnose()} disabled={busy}>What went wrong?</button>
        </div>
      </div>
      <div className="session-summary-body">
        <div className="summary-ai">
          <AgentOutput output={agent.output} running={agent.running} error={agent.error} />
        </div>

        <Section title="Summary">
          <Field label="Estimated cost" value={
            <>
              {meta.priceUnknown && <span className="danger-badge" role="img" aria-label="No price entry" data-tooltip-content={`No price entry for ${modelLabel} — cost is missing or understated`}><DollarSign size={11} /></span>}
              <span className={tone(sofar.cost, T.cost)}>{fmtUSD(sofar.cost)}</span>
            </>
          } />
          <Field label="Total tokens" value={<span className={tone(sofar.totalTokens, T.tokens)}>{fmtCompact(sofar.totalTokens)}</span>} />
          <Field label="Working time" value={fmtDuration(sofar.activeMs)} />
          <Field
            label="Context size"
            value={<><span className={tone(point.size, T.context)}>{rough && '~'}{fmtCompact(point.size)}</span> / {fmtCompact(ctxLimit).replace('.0', '')}</>}
            below={<ContextFill size={point.size} limit={ctxLimit} note={rough ? 'Estimated until the next reply: what the compaction kept plus the System row' : undefined} />}
          />
        </Section>
        {events.length > 0 && (
          <Section title="Events" aside={<EventStep earlier={earlier} later={later} onJump={onJump} />}>
            <SessionEvents events={events} picked={picked} onJump={onJump} />
          </Section>
        )}
        {parts.length > 0 && (
          <Section title={<span>Context breakdown<ContextInfo /></span>}>
            <ContextUsage parts={parts} />
          </Section>
        )}

        {(advice || advisor?.cost > 0) && (
          <Section title="Potential savings">
            {advice && (
              <Field
                label={<><strong>-{advice.pct.toFixed(0)}% </strong>{CACHE_LABELS[advice.policy]}</>}
                value={`−${fmtUSD(advice.saving)}`}
              />
            )}
            {advisor?.cost > 0 && (
              <Field
                label={<span data-tooltip-content={`${plural(advisor.calls, 'advisor call')} on ${advisor.models.join(', ')}, billed apart\nTurn it off with /advisor off`}><strong>-{(advisor.cost / cost * 100).toFixed(0)}% </strong>Advisor</span>}
                value={`−${fmtUSD(advisor.cost)}`}
              />
            )}
          </Section>
        )}

        <Section title="Tokens">
          <Field label="Input" value={fmtNum(t.input)} />
          <Field label="Output" value={fmtNum(t.output)} />
          <Field label="Cache write (5m)" value={fmtNum(t.cacheCreation5m || 0)} />
          <Field label="Cache write (1h)" value={fmtNum(t.cacheCreation1h || 0)} />

          <Field label="Cache read" value={fmtNum(t.cacheRead)} />
          <Field label="Cache hit ratio" value={`${(sofar.cacheHitRatio * 100).toFixed(0)}%`} />
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
          <Field label="Messages" value={fmtNum(meta.messageCount)} />
          <Field label="Tool calls" value={fmtToolCalls(meta)} />
          {compactions > 0 && <Field label="Compactions" value={fmtNum(compactions)} />}
          {rewinds > 0 && <Field label="Rewinds" value={fmtNum(rewinds)} />}
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
          {meta.experiment && <Field label="Anthropic experiment" value={<span data-tooltip-content={EXPERIMENT_TIP}>yes</span>} />}
          <Field label="CLI version" value={meta.version || '—'} mono />
          <Field label="Project" value={meta.project || '—'} mono full autoselect />
          {meta.subdir && <Field label="Subfolder" value={meta.subdir} mono full autoselect />}
          {meta.worktreePath && <Field label="Worktree" value={meta.worktreePath} mono full autoselect />}
          <Field label="Log file" value={meta.filePath} mono full autoselect />
          {requestLog && <Field label="Proxy log" value={requestLog} mono full autoselect />}
          {debugLog && <Field label="Debug log" value={debugLog} mono full autoselect />}
        </Section>
      </div>
    </div>
  )
}

function Section({ title, aside, children }) {
  return (
    <div className="summary-section">
      <div className="summary-section-title">{title}{aside}</div>
      {children}
    </div>
  )
}

function Field({ label, value, mono, full, below, autoselect }) {
  const selectAll = autoselect ? e => {
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
