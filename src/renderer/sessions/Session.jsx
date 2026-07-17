import React, { useEffect, useRef, useState } from 'react'
import ConversationView from './view/ConversationView.jsx'
import JsonlView from './view/JsonlView.jsx'
import RequestsView from './view/RequestsView.jsx'
import AgentView from './view/AgentView.jsx'
import SessionSummary from './SessionSummary.jsx'
import Toggle from '../ui/Toggle.jsx'
import { useAgent } from '../agent/Agent.js'
import { useLocalStorage } from '../utils/useLocalStorage.js'
import './Session.css'

const TABS = [
  { key: 'conversation', label: 'Conversation' },
  { key: 'jsonl', label: 'Raw Logs' },
  { key: 'requests', label: 'API Requests' },
]

export default function Session({ meta, date, granularity = 'day' }) {
  const [items, setItems]         = useState(null)
  const [loading, setLoading]     = useState(false)
  const [mode, setMode]           = useLocalStorage('session.view-mode', 'conversation')
  const [agentOpen, setAgentOpen] = useState(false)
  const [expandAll, setExpandAll] = useState(null)
  const offsetRef = useRef(0)
  const sessionId = meta?.sessionId
  const fileSize = meta?.fileSize
  const agent = useAgent(`${sessionId}|${date}`)

  useEffect(() => {
    offsetRef.current = 0
    setItems(null)
    setLoading(!!sessionId)
  }, [sessionId, date, granularity])

  useEffect(() => {
    if (!sessionId || fileSize <= offsetRef.current) return
    let cancelled = false
    const from = offsetRef.current
    window.api.readSession(sessionId, from, date || null, granularity).then((res) => {
      if (cancelled || !res) return
      offsetRef.current = res.nextOffset
      setItems((prev) => from === 0 ? res.items : (prev || []).concat(res.items))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [sessionId, date, granularity, fileSize])

  if (!meta) {
    return <div className="session-view empty"><div>Select a session to inspect.</div></div>
  }

  return (
    <div className="session-view">
      <div className="view-body">
        <div className="view-conversation">
          {agentOpen ? (
            <AgentView meta={meta} items={items} agent={agent} onClose={() => setAgentOpen(false)} />
          ) : (
            <div className="view-tab-pane">
              <div className="view-tab-pane-row">
                <div className="view-tab-pane-main">
                  <div className="view-tabs-bar">
                    <div className="view-tabs">
                      {TABS.map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          className={`view-tab${mode === key ? ' active' : ''}`}
                          onClick={() => setMode(key)}
                        >{label}</button>
                      ))}
                    </div>
                    <Toggle
                      checked={!!expandAll}
                      onChange={(v) => setExpandAll(v)}
                      label={mode === 'conversation' ? 'Expand all' : 'Full text'}
                    />
                  </div>
                  {mode === 'conversation' ? (
                    <div className="view-tab-pane-content">
                      {loading && <div className="empty">Loading conversation…</div>}
                      {items && <ConversationView items={items} expandAll={expandAll} />}
                    </div>
                  ) : mode === 'jsonl' ? (
                    <JsonlView items={items} expandAll={expandAll} />
                  ) : (
                    <RequestsView sessionId={sessionId} date={date} granularity={granularity} expandAll={expandAll} />
                  )}
                </div>
                <SessionSummary meta={meta} items={items} agent={agent} onOpenAgent={() => setAgentOpen(true)} granularity={granularity} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
