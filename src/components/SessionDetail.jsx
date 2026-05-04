import React, { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import {fmtDuration, fmtBytes, fmtNum, fmtUSD, fmtCompact, tone} from '../utils/formatting.js'
import { THRESHOLDS as T } from '../utils/thresholds.js'
import ConversationView from './ConversationView.jsx'
import JsonlViewer from './JsonlViewer.jsx'
import './SessionDetail.css'

const CONTEXT_WINDOW = T.context.danger

export default function SessionDetail({ meta, date }) {
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('conversation')
  const offsetRef = useRef(0)
  const sidRef = useRef(null)

  const sessionId = meta?.sessionId
  const fileSize = meta?.fileSize
  const key = sessionId ? `${sessionId}|${date || ''}` : null

  useEffect(() => {
    if (!sessionId) {
      setItems(null)
      offsetRef.current = 0
      sidRef.current = null
      return
    }
    const sidChanged = sidRef.current !== key
    if (sidChanged) {
      offsetRef.current = 0
      sidRef.current = key
      setItems(null)
      setLoading(true)
    } else if (fileSize <= offsetRef.current) {
      return
    }
    let cancelled = false
    const fromOffset = offsetRef.current
    window.api.readSession(sessionId, fromOffset, date || null).then((res) => {
      if (cancelled || !res) return
      offsetRef.current = res.nextOffset
      setItems((prev) => fromOffset === 0 ? res.items : prev.concat(res.items))
      setLoading(false)
    })
    return () => { cancelled = true
     }
  }, [key, fileSize])

  if (!meta) {
    return <div className="session-detail empty"><div>Select a session to inspect.</div></div>
  }

  const t = meta.tokens
  const totalTokens = meta.totalTokens
  const wallDuration = meta.lastActivityAt - meta.startedAt
  const activeDuration = meta.activeMs
  const cost = meta.cost
  const cacheHitRatio = meta.cacheHitRatio
  const stu = meta.serverToolUse
  const hasServerTools = stu.webSearch > 0 || stu.webFetch > 0
  const modelLabel = meta.models.join(', ') || '—'

  const ratio = meta.lastContextTokens / CONTEXT_WINDOW
  const context = {
    ratio: ratio,
    tone: ratio >= 0.9 ? 'danger' : ratio >= 0.7 ? 'warn' : 'ok',
    label: `${fmtCompact(meta.lastContextTokens)} / ${fmtCompact(CONTEXT_WINDOW)}`,
  }

  return (
    <div className="session-detail">
      <div className="detail-body">
        <div className="detail-conversation">
          <div className="detail-tabs">
            <button
              type="button"
              className={`detail-tab ${tab === 'conversation' ? 'active' : ''}`}
              onClick={() => setTab('conversation')}
            >Conversation</button>
            <button
              type="button"
              className={`detail-tab ${tab === 'jsonl' ? 'active' : ''}`}
              onClick={() => setTab('jsonl')}
            >JSONL</button>
          </div>
          {tab === 'conversation' ? (
            <div className="detail-tab-pane">
              {loading && <div className="empty">Loading conversation…</div>}
              {items && <ConversationView items={items} />}
            </div>
          ) : (
            <JsonlViewer filePath={meta.filePath} />
          )}
        </div>
        <div className="detail-meta">
          <Section title="Summary">
            <Field label="Working time" value={
              <span className={tone(activeDuration, T.workTime)}>{fmtDuration(activeDuration)}</span>
            } />
            <Field label="Total tokens" value={<span className={tone(totalTokens, T.tokens)}>{fmtCompact(totalTokens)}</span>} />
            <Field label="Estimated cost" value={<span className={tone(cost, T.cost)}>{fmtUSD(cost)}</span>} />
            <Field label="Context size" value={
              <span className={tone(meta.lastContextTokens, T.context)}>{context.label}</span>
            } below={
              <Bar ratio={context.ratio} tone={context.tone} />
            }/>
          </Section>

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
            <Field label="Started" value={format(meta.startedAt, 'pp')} />
            <Field label="Last activity" value={format(meta.lastActivityAt, 'pp')} />
            <Field label="Wall duration" value={fmtDuration(wallDuration)} />
            <Field label="Active periods" value={fmtNum(meta.activityPeriods.length)} />
            <Field label="Messages" value={
              <span className={tone(meta.messageCount, T.messages)}>{fmtNum(meta.messageCount)}</span>
            } />
          </Section>

          <Section title="Identity">
            <Field label="Model" value={modelLabel} mono />
            {meta.serviceTier && <Field label="Service tier" value={meta.serviceTier} />}
            <Field label="Git branch" value={meta.gitBranch || '—'} mono />
            <Field label="Source" value={meta.source || meta.entrypoint || '—'} />
            {meta.hasScheduledTask && <Field label="Scheduled" value="yes" />}
            <Field label="CLI version" value={meta.version || '—'} mono />
            <Field label="Session ID" value={meta.sessionId} mono full autoselect />
            <Field label="cwd" value={meta.cwd || '—'} mono full autoselect />
            <Field label="Log file" value={meta.filePath} mono full autoselect />
            <Field label="File size" value={fmtBytes(meta.fileSize)} />
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="detail-section">
      <div className="detail-section-title">{title}</div>
      {children}
    </div>
  )
}

function Bar({ ratio, tone = 'ok' }) {
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

