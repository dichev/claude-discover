import React, { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { fmtDuration, fmtBytes, fmtNum, fmtUSD } from '../utils/formatting.js'
import ConversationView from './ConversationView.jsx'

export default function SessionDetail({ meta, date }) {
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(false)
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
  const tokensSectionTitle = date ? `Tokens & Cost (${date})` : 'Tokens & Cost'

  return (
    <div className="session-detail">
      <div className="detail-body">
        <div className="detail-conversation">
          {loading && <div className="empty">Loading conversation…</div>}
          {items && <ConversationView items={items} />}
        </div>
        <div className="detail-meta">
          {(meta.aiTitle || meta.summary) && (
            <Section title="Summary">
              {meta.aiTitle && <Field label="AI Title" value={meta.aiTitle} full />}
              {meta.summary && <Field label="Summary" value={meta.summary} full />}
            </Section>
          )}

          <Section title={tokensSectionTitle}>
            <Field label="Model" value={modelLabel} mono />
            {meta.serviceTier && <Field label="Service tier" value={meta.serviceTier} />}
            <Field label="Estimated cost" value={fmtUSD(cost)} />
            <Field label="Total tokens" value={fmtNum(totalTokens)} />
            <Field label="Input" value={fmtNum(t.input)} />
            <Field label="Output" value={fmtNum(t.output)} />
            <Field label="Cache read" value={fmtNum(t.cacheRead)} />
            <Field label="Cache write (5m)" value={fmtNum(t.cacheCreation5m || 0)} />
            <Field label="Cache write (1h)" value={fmtNum(t.cacheCreation1h || 0)} />
            {cacheHitRatio != null && (
              <Field label="Cache hit ratio" value={`${(cacheHitRatio * 100).toFixed(1)}%`} />
            )}
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
            <Field label="Working time" value={fmtDuration(activeDuration)} />
            <Field label="Active periods" value={fmtNum(meta.activityPeriods.length)} />
            <Field label="Messages" value={fmtNum(meta.messageCount)} />
            <Field label="File size" value={fmtBytes(meta.fileSize)} />
          </Section>

          <Section title="Identity">
            <Field label="Git branch" value={meta.gitBranch || '—'} mono />
            <Field label="Source" value={meta.source || meta.entrypoint || '—'} />
            {meta.hasScheduledTask && <Field label="Scheduled" value="yes" />}
            <Field label="CLI version" value={meta.version || '—'} mono />
            <Field label="Session ID" value={meta.sessionId} mono full />
            <Field label="cwd" value={meta.cwd || '—'} mono full />
            <Field label="Log file" value={meta.filePath} mono full />
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

function Field({ label, value, mono, full }) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <div className="field-label">{label}</div>
      <div className={`field-value ${mono ? 'mono' : ''}`}>{value}</div>
    </div>
  )
}

