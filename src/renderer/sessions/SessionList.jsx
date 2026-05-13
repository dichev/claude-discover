import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SOURCE_COLORS, SOURCE_LABELS } from '../utils/colors.js'
import { format } from 'date-fns'
import { fmtCompact, fmtNum, fmtUSD, fmtDuration, tone } from '../utils/formatting.js'
import { THRESHOLDS as T } from '../utils/thresholds.js'
import { parseCommand } from '../utils/textBlock.js'
import './SessionList.css'

export default function SessionList({ sessions, selectedId, onSelect }) {
  const selectedRef = useRef(null)
  const [sortBy, setSortBy] = useState('time')
  const [filter, setFilter] = useState('')

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])


  const cmd = (text) => {
    const c = parseCommand(text)
    return c ? `${c.name || c.message} ${c.args}` : ''
  }
  const sessionLabel = (s) => s.aiTitle || s.summary || s.firstUserPrompt || cmd(s.firstUserCommand) || s.sessionId || ''

  const q = filter.trim().toLowerCase()
  const filtered = q ? sessions.filter((s) => [
    s.customTitle, s.agentName, s.aiTitle, s.summary, s.firstUserPrompt, s.firstUserCommand, s.cwd, s.sessionId, s.model, s.gitBranch
  ].filter(Boolean).join(' ').toLowerCase().includes(q)) : sessions

  const sorted = sortBy === 'cost'   ? [...filtered].sort((a, b) => (b.cost || 0) - (a.cost || 0))
               : sortBy === 'tokens' ? [...filtered].sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0))
               : sortBy === 'name'   ? [...filtered].sort((a, b) => sessionLabel(a).toLowerCase().localeCompare(sessionLabel(b).toLowerCase()))
               : filtered

  const grouped = useMemo(() => {
    const ids = new Set(sorted.map((s) => s.sessionId))
    const isChild = (s) => !!s.parentSessionId && ids.has(s.parentSessionId)
    return sorted.flatMap((s) => isChild(s) ? [] : [
      { session: s, isChild: false },
      ...sorted.filter((c) => c.parentSessionId === s.sessionId).map((c) => ({ session: c, isChild: true }))
    ])
  }, [sorted])


  return (
    <div className="session-list">
      <div className="session-list-header">
        <input
          className="filter"
          placeholder="Filter sessions…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="session-list-header-row">
          <div className="session-count">{sorted.length} sessions</div>
          <div className="sort-toggle" role="group" aria-label="Sort sessions">
            <span className="sort-toggle-label">Sort by:</span>
            <button type="button" className={`sort-pill ${sortBy === 'time'   ? 'active' : ''}`} onClick={() => setSortBy('time')}>Time</button>
            <button type="button" className={`sort-pill ${sortBy === 'name'   ? 'active' : ''}`} onClick={() => setSortBy('name')}>Name</button>
            <button type="button" className={`sort-pill ${sortBy === 'cost'   ? 'active' : ''}`} onClick={() => setSortBy('cost')}>Cost</button>
            <button type="button" className={`sort-pill ${sortBy === 'tokens' ? 'active' : ''}`} onClick={() => setSortBy('tokens')}>Tokens</button>
          </div>
        </div>
      </div>
      <div className="session-list-scroll">
        {sorted.length === 0 && (
          <div className="empty">No sessions on this day.</div>
        )}
        {grouped.map(({ session: s, isChild }) => {
          const isSubagent = s.sessionId.startsWith('agent-')
          const isFork = !!s.forkedFrom
          const sessionName = s.customTitle && s.agentName && s.customTitle !== s.agentName
            ? `${s.customTitle} [${s.agentName}]`
            : (s.customTitle || s.agentName || '')
          return (
            <div
              key={s.sessionId}
              ref={selectedId === s.sessionId ? selectedRef : null}
              className={`session-row ${selectedId === s.sessionId ? 'selected' : ''} ${isChild ? 'is-subagent-child' : ''}`}
              onClick={() => onSelect(selectedId === s.sessionId ? null : s.sessionId)}
              style={{ borderLeftColor: SOURCE_COLORS[s.source] || SOURCE_COLORS.other }}
              title={s.cwd || ''}
            >
              <div className="session-row-main">
                <div className="session-label">
                  {s.tokens?.cacheCreation1h > 0 && <span className="warn-badge" title={`Used 1h extended cache (${fmtNum(s.tokens.cacheCreation1h)} tokens)`}>1h</span>}
                  {s.lastContextTokens > T.context.danger && <span className="danger-badge" title={`Context size: ${fmtNum(s.lastContextTokens)} tokens`}>CTX</span>}
                  {s.lastContextTokens > T.context.warn && s.lastContextTokens <= T.context.danger && <span className="warn-badge" title={`Context size: ${fmtNum(s.lastContextTokens)} tokens`}>CTX</span>}
                  {s.messageCount > T.messages.danger && <span className="danger-badge" title={`${fmtNum(s.messageCount)} messages`}>MSG</span>}
                  {s.messageCount > T.messages.warn && s.messageCount <= T.messages.danger && <span className="warn-badge" title={`${fmtNum(s.messageCount)} messages`}>MSG</span>}
                  {s.activeMs > T.workTime.danger && <span className="danger-badge" title={`Working time: ${fmtDuration(s.activeMs)}`}>TIME</span>}
                  {s.activeMs > T.workTime.warn && s.activeMs <= T.workTime.danger && <span className="warn-badge" title={`Working time: ${fmtDuration(s.activeMs)}`}>TIME</span>}
                  {isSubagent && <span className="subagent-tag">[subagent]</span>}
                  {isFork && <span className="fork-tag" title={`Forked from session ${s.forkedFrom.sessionId}`}>↳</span>}
                  {sessionName && <span className="session-name">{sessionName}</span>}
                  {sessionLabel(s)}
                </div>
                <div className="session-time-bottom">
                  <span>{format(s.lastActivityAt, 'HH:mm:ss')}</span>
                  {s.models?.length > 0 && <span className="session-model">, {s.models.map((m) => m.replace(/^claude-/, '')).join(', ')}</span>}
                </div>
              </div>
              <div className="session-row-stats">
                <span className={`${sortBy === 'tokens' ? 'stat-primary' : 'stat-secondary'} ${tone(s.totalTokens, T.tokens)}`} title={s.totalTokens ? `${s.totalTokens.toLocaleString()} tokens` : ''}>
                  {fmtCompact(s.totalTokens)}
                </span>
                <span className={`${sortBy === 'cost' ? 'stat-primary' : 'stat-secondary'} ${tone(s.cost, T.cost)}`} title={s.cost ? `$${s.cost.toFixed(4)}` : 'No cost data'}>
                  {s.cost ? fmtUSD(s.cost) : '—'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

