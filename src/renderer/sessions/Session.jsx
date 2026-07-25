import React, { useEffect, useState } from 'react'
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

export default function Session({ meta, missing, date, granularity = 'day' }) {
  const [items, setItems]               = useState(null)
  const [instructions, setInstructions] = useState([])
  const [mode, setMode]                 = useLocalStorage('session.view-mode', 'conversation')
  const [agentOpen, setAgentOpen]       = useState(false)
  const [expandAll, setExpandAll]       = useState(null)
  const sessionId = meta?.sessionId
  const fileSize = meta?.fileSize
  const agent = useAgent(`${sessionId}|${date}`)

  // Clear only when the session identity changes — live growth (fileSize) swaps
  // the content in place below, without flashing the loading state.
  useEffect(() => {
    setItems(null)
    setInstructions([])
  }, [sessionId, date, granularity])

  // Re-read the whole session whenever it grows: rows are keyed by turn uuid, so
  // replacing `items` wholesale keeps the expanded/collapsed state of existing rows.
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    window.api.readSession(sessionId, date || null, granularity).then((res) => {
      if (cancelled || !res) return
      setItems(res.items)
      setInstructions(res.instructions || [])
    })
    return () => { cancelled = true }
  }, [sessionId, date, granularity, fileSize])

  if (!meta) { // `missing` explains an empty pane (unknown session / empty period); see App.jsx
    return (
      <div className="session-view empty">
        {missing ? <div className="session-missing">⚠ {missing}</div> : <div>Select a session to inspect.</div>}
      </div>
    )
  }

  return (
    <div className="session-view">
      <div className="view-body">
        <div className="view-conversation">
          {agentOpen ? (
            <AgentView meta={meta} items={items} instructions={instructions} agent={agent} onClose={() => setAgentOpen(false)} />
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
                      {items ? <ConversationView items={items} instructions={instructions} expandAll={expandAll} />
                             : <div className="empty">Loading conversation…</div>}
                    </div>
                  ) : mode === 'jsonl' ? (
                    <JsonlView items={items} expandAll={expandAll} />
                  ) : (
                    <RequestsView sessionId={sessionId} date={date} granularity={granularity} fileSize={fileSize} expandAll={expandAll} />
                  )}
                </div>
                <SessionSummary meta={meta} items={items} instructions={instructions} agent={agent} onOpenAgent={() => setAgentOpen(true)} granularity={granularity} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
