import React, { useEffect, useRef, useState } from 'react'
import ConversationView from './view/ConversationView.jsx'
import JsonlView from './view/JsonlView.jsx'
import AgentView from './view/AgentView.jsx'
import SessionSummary from './view/SessionSummary.jsx'
import { useAgentPrompt } from '../agent/AgentPrompt.jsx'
import './SessionView.css'

export default function SessionView({ meta, date }) {
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('conversation')
  const offsetRef = useRef(0)
  const sessionId = meta?.sessionId
  const fileSize = meta?.fileSize
  const agent = useAgentPrompt(`${sessionId}|${date}`)

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
          <div className="view-tabs">
            <Tab active={tab === 'conversation'} onClick={() => setTab('conversation')}>Conversation</Tab>
            <Tab active={tab === 'jsonl'} onClick={() => setTab('jsonl')}>JSONL</Tab>
          </div>
          {tab === 'conversation' && (
            <div className="view-tab-pane">
              <div className="view-tab-pane-row">
                <div className="view-tab-pane-main">
                  {loading && <div className="empty">Loading conversation…</div>}
                  {items && <ConversationView items={items} />}
                </div>
                <SessionSummary meta={meta} items={items} agent={agent} onOpenAgent={() => setTab('agent')} />
              </div>
            </div>
          )}
          {tab === 'agent' && <AgentView meta={meta} items={items} agent={agent} onClose={() => setTab('conversation')} />}
          {tab === 'jsonl' && <JsonlView filePath={meta.filePath} />}
        </div>
      </div>
    </div>
  )
}

function Tab({ active, onClick, children }) {
  return (
    <button type="button" className={`view-tab ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}
