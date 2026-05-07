import React, { useEffect, useRef, useState } from 'react'
import ConversationView from './view/ConversationView.jsx'
import JsonlView from './view/JsonlView.jsx'
import AgentView from './view/AgentView.jsx'
import SessionSummary from './view/SessionSummary.jsx'
import Toggle from '../ui/Toggle.jsx'
import { useAgent } from '../agent/Agent.js'
import './SessionView.css'

export default function SessionView({ meta, date }) {
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('conversation')
  const [agentOpen, setAgentOpen] = useState(false)
  const offsetRef = useRef(0)
  const sessionId = meta?.sessionId
  const fileSize = meta?.fileSize
  const agent = useAgent(`${sessionId}|${date}`)

  useEffect(() => {
    offsetRef.current = 0
    setItems(null)
    setLoading(!!sessionId)
  }, [sessionId, date])

  useEffect(() => {
    if (!sessionId || fileSize <= offsetRef.current) return
    let cancelled = false
    const from = offsetRef.current
    window.api.readSession(sessionId, from, date || null).then((res) => {
      if (cancelled || !res) return
      offsetRef.current = res.nextOffset
      setItems((prev) => from === 0 ? res.items : (prev || []).concat(res.items))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [sessionId, date, fileSize])

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
                  <div className="view-mode-toggle">
                    <Toggle
                      checked={mode === 'jsonl'}
                      onChange={(v) => setMode(v ? 'jsonl' : 'conversation')}
                      label="JSONL"
                    />
                  </div>
                  {mode === 'conversation' ? (
                    <div className="view-tab-pane-content">
                      {loading && <div className="empty">Loading conversation…</div>}
                      {items && <ConversationView items={items} />}
                    </div>
                  ) : (
                    <JsonlView filePath={meta.filePath} />
                  )}
                </div>
                <SessionSummary meta={meta} items={items} agent={agent} onOpenAgent={() => setAgentOpen(true)} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
