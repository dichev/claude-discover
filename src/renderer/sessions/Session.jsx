import { useEffect, useRef, useState } from 'react'
import ConversationView, { FILTERS } from './view/ConversationView.jsx'
import JsonlView from './view/JsonlView.jsx'
import RequestsView from './view/RequestsView.jsx'
import SessionSummary from './SessionSummary.jsx'
import { sessionEvents } from './events/sessionEvents.js'
import { flatten } from './view/transcript.js'
import MultiPicker from '../ui/MultiPicker.jsx'
import Toggle from '../ui/Toggle.jsx'
import { ErrorMessage } from '../ui/Errors.jsx'
import UsageBehaviors from '../usage/UsageBehaviors.jsx'
import { useAgent } from '../agent/Agent.js'
import { useLocalStorage } from '../utils/useLocalStorage.js'
import './Session.css'

const NOT_READ = { items: null, instructions: {}, requestLog: null, debugLog: null }

// Re-applies a jump as the conversation's height changes, until it holds for a moment or the user scrolls, then calls `done`: a jump
// into the middle holds by scroll anchoring, but the end doesn't, as rows and their markdown keep mounting in view. Returns what stops it
function settle(pane, jump, done) {
  let timer
  const input = ['wheel', 'pointerdown', 'keydown', 'touchstart']
  const stop = () => { clearTimeout(timer); observer.disconnect(); input.forEach(e => pane.removeEventListener(e, finish)) }
  const finish = () => { stop(); done() }
  const observer = new ResizeObserver(() => {
    jump()
    clearTimeout(timer)
    timer = setTimeout(finish, 300)
  })
  observer.observe(pane.firstElementChild ?? pane) // calls back once at the start too
  input.forEach(e => pane.addEventListener(e, finish, { passive: true }))
  return stop
}

// Scrolls the conversation pane to its 'bottom' or the row of a turn's uuid; the first row to the very top, above which a banner can sit
const scrollPane = (pane, to, done) => settle(pane, () => {
  const row = pane.querySelector(`[data-turn="${to}"]`)
  if (to === 'bottom') pane.scrollTop = pane.scrollHeight
  else if (row === pane.querySelector('[data-turn]')) pane.scrollTop = 0
  else row?.scrollIntoView()
}, done)

// The first conversation row whose top is in the pane, by its first turn's uuid, so its dot on the token timeline shows; a row
// taller than the pane, the one across its top. null at the bottom
function topRow(pane) {
  if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2) return null
  const box  = pane.getBoundingClientRect()
  const rows = [...pane.firstElementChild?.children ?? []].filter(el => el.dataset.turn) // not a nested conversation's
  const top  = el => el.getBoundingClientRect().top
  let lo = 0, hi = rows.length // binary search: the rows run down in order
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (top(rows[mid]) < box.top) lo = mid + 1
    else hi = mid
  }
  const row = lo < rows.length && top(rows[lo]) < box.bottom ? rows[lo] : rows[lo - 1]
  return row?.dataset.turn
}

const TABS = [
  { key: 'conversation', label: 'Conversation' },
  { key: 'jsonl', label: 'Raw Logs' },
  { key: 'requests', label: 'API Requests' },
]

export default function Session({ meta, missing, date, granularity = 'day', onShowPeriodOf }) {
  const [read, setRead]                 = useState(NOT_READ)
  const [error, setError]               = useState(null)
  const [mode, setMode]                 = useLocalStorage('session.view-mode', 'conversation')
  const [expandAll, setExpandAll]       = useState(null)
  const [filter, setFilter]             = useState([])
  const [at, setAt]                     = useState(null) // the conversation row the context is shown at (see contextAt): its first turn's uuid, null for the end
  const paneRef                         = useRef(null)
  const stopJump                        = useRef(null) // stops the jump still settling, for the next one; null when none is
  const frame                           = useRef(0)
  const opened                          = useRef(null) // the view the conversation was last opened at the end of
  const filePath = meta?.filePath // not the session id, which can cover several transcripts
  const fileSize = meta?.fileSize
  const desktop  = meta?.entrypoint === 'claude-desktop' // the capture proxy can't reach desktop sessions yet (see ProxySwitch)
  const { items, instructions, requestLog, debugLog } = read
  const turns = items ? flatten(items, instructions) : []
  const viewKey = `${filePath}|${date}|${granularity}` // what the read (and so an agent answer) covers
  const agent = useAgent(viewKey, meta, read)

  // Clear only when the session identity changes — live growth (fileSize) swaps
  // the content in place below, without flashing the loading state.
  const [readKey, setReadKey] = useState(viewKey)
  if (readKey !== viewKey) {
    setReadKey(viewKey)
    setRead(NOT_READ)
    setError(null)
    setAt(null) // a view opens at the context now, also coming back to one
  }

  // Re-read the whole session whenever it grows: rows are keyed by turn uuid, so
  // replacing `items` wholesale keeps the expanded/collapsed state of existing rows.
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    window.api.readSession(filePath, date || null, granularity).then(res => {
      if (cancelled || !res) return
      setRead({ ...res, instructions: res.instructions || {} })
      setError(null)
    }, err => {
      if (!cancelled) setError(err)
    })
    return () => { cancelled = true }
  }, [filePath, date, granularity, fileSize])

  // A scroll of ours, not tracked as reading
  const scrollTo = (pane, to) => {
    stopJump.current?.()
    stopJump.current = scrollPane(pane, to, () => { stopJump.current = null })
  }

  // Shows the context at an event's row (its `at`, see sessionEvents), scrolling there while the Conversation tab shows.
  // The scroll it makes isn't tracked, so a row that can't reach the top (near the end) still shows the context picked
  const jump = ({ at: to }) => {
    setAt(to === 'bottom' ? null : to)
    const pane = paneRef.current
    if (pane) scrollTo(pane, to)
  }

  // Scrolling by hand shows the context at the row on top, once a frame
  const track = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (stopJump.current) return // a frame pending as a jump began
      const row = paneRef.current && topRow(paneRef.current)
      if (row !== undefined) setAt(row)
    })
  }

  // A conversation opens at its end, where the context shown is, once it's read; again on coming back to it from another tab or session
  useEffect(() => {
    const pane = paneRef.current
    if (!pane) opened.current = null // another tab, or none selected
    if (!pane || !items || opened.current === viewKey) return
    opened.current = viewKey
    scrollTo(pane, 'bottom')
  }, [items, mode, viewKey])

  if (!meta) { // `missing` explains an empty pane (unknown session / empty period / failed list); see App.jsx
    return (
      <div className="session-view empty">
        {missing?.error ? <ErrorMessage title={missing.text} error={missing.error} />
          : missing?.warn ? <div className="session-missing">⚠ {missing.text}</div>
          : missing?.text ? <div>{missing.text}</div>
          : <UsageBehaviors date={date} granularity={granularity} />}
      </div>
    )
  }

  const loadError = error && <ErrorMessage title="Couldn't load this session" error={error} />
  const events    = sessionEvents(turns, meta)

  return (
    <div className="session-view">
      <div className="view-body">
        <div className="view-conversation">
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
                        onClick={() => { setMode(key); setAt(null) }}
                      >{label}</button>
                    ))}
                  </div>
                  <div className="view-tabs-tools">
                    {mode === 'conversation' && <MultiPicker className="view-filter" options={FILTERS} value={filter} onChange={setFilter} allLabel="All messages" />}
                    <Toggle
                      checked={!!expandAll}
                      onChange={v => setExpandAll(v)}
                      label={mode === 'conversation' ? 'Expand all' : 'Full text'}
                    />
                  </div>
                </div>
                {mode === 'conversation' ? (
                  <div ref={paneRef} className="view-tab-pane-content" onScroll={track}>
                    {items ? <ConversationView
                               items={items} turns={turns} filePath={meta.parentFilePath ?? meta.filePath} expandAll={expandAll} filter={filter}
                               continuesFrom={meta.continuesFrom} continuesTo={meta.continuesTo} forkedFrom={meta.forkedFrom} forkedAt={meta.forkedAt}
                               onShowPeriodOf={onShowPeriodOf} mark={at} onMark={setAt} events={events}
                             />
                           : loadError || <div className="empty">Loading conversation…</div>}
                  </div>
                ) : mode === 'jsonl' ? (
                  (!items && loadError) || <JsonlView items={items} expandAll={expandAll} />
                ) : (
                  <RequestsView
                    filePath={filePath} items={items} date={date} granularity={granularity} fileSize={fileSize} desktop={desktop} expandAll={expandAll}
                  />
                )}
              </div>
              <SessionSummary
                key={viewKey} meta={meta} items={items} turns={turns} events={events} instructions={instructions} requestLog={requestLog} debugLog={debugLog}
                agent={agent} at={at} onJump={jump} granularity={granularity}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
