import React, { useDeferredValue, useEffect, useRef, useState } from 'react'
import JsonView from '@uiw/react-json-view'
import { vscodeTheme } from '@uiw/react-json-view/vscode'
import LazyMount from '../../ui/LazyMount.jsx'
import { useFindActive } from '../../ui/useFindActive.js'
import { renderShortened } from '../../ui/ShortText.jsx'
import { useMouseFontScale } from '../../utils/useMouse.js'
import './RequestsView.css'

const time = ts => ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : ''
const duration = ms => ms == null ? '' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
const size = bytes => bytes == null ? '' : bytes < 1024 ? `${bytes}B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)}KB` : `${(bytes / (1024 * 1024)).toFixed(1)}MB`
const splitUrl = url => { const [method, ...path] = (url || '').split(' '); return [method, path.join(' ')] }
const tokens = n => n == null ? '' : n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`

// Total tokens billed for a request: input + output + both cache tiers, from the response usage.
const totalTokens = rec => {
  const u = rec?.response?.usage
  if (!u) return null
  return (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
}

// A request whose trailing user message carries no tool_result starts a new user turn
// (agentic-loop continuations always end with the previous turn's tool results).
const startsUserTurn = rec => {
  const msgs = rec?.request?.messages
  const last = msgs?.[msgs.length - 1]
  if (last?.role !== 'user') return false
  return typeof last.content === 'string' || (Array.isArray(last.content) && !last.content.some(b => b.type === 'tool_result'))
}

// What a collapsed node shows instead of the bare '...': role + content block types for
// messages, element counts for arrays. Anything else falls back to the default ellipsis.
const collapsedHint = (value, keyName) => {
  if (value?.role) {
    const counts = new Map()
    for (const b of Array.isArray(value.content) ? value.content : [{ type: 'text' }]) counts.set(b.type, (counts.get(b.type) || 0) + 1)
    // role padded past 'assistant:' so the block summaries align across stacked collapsed messages
    return `${value.role}:`.padEnd(11) + [...counts].map(([t, n]) => n > 1 ? `${n} ${t}` : t).join(', ')
  }
  if (Array.isArray(value)) return `${value.length} ${keyName === 'tools' ? 'tools' : keyName === 'system' ? 'blocks' : 'items'}`
  return null
}

function Tree({ value, expandAll, collapsed = false, seenKeys = null }) {
  // JsonView copies callbacks/overrides into internal stores one effect-tick late, so closures
  // over props render one record behind when the tree is reused for another record. The ref keeps
  // whatever closure the store holds reading the current props instead.
  const live = useRef({})
  live.current = { collapsed, seenKeys }
  // Initial collapse is per-node, everything else starts expanded: `collapsed` folds just the
  // root, `seenKeys` fold just those top-level keys — so unfolding a node reveals its whole content.
  const expandInitially = (_, { keys }) => {
    const { collapsed, seenKeys } = live.current
    return collapsed ? keys.length > 0 : !(keys.length === 1 && seenKeys?.includes(keys[0]))
  }
  return (
    <JsonView
      value={value}
      style={vscodeTheme}
      displayDataTypes={false}
      displayObjectSize={false}
      shortenTextAfterLength={0} // shortening is ours (see ui/ShortText.jsx); the toggle turns it off
      highlightUpdates={false}
      enableClipboard={false}
      shouldExpandNodeInitially={expandInitially}
    >
      <JsonView.String render={renderShortened(!expandAll)} />
      {/* data-expanded is inverted in the lib: true = collapsed. undefined falls through to '...' */}
      <JsonView.Ellipsis render={({ 'data-expanded': isCollapsed, style, ...props }, { value: v, keyName }) => {
        const hint = isCollapsed ? collapsedHint(v, keyName) : null
        return hint ? <span {...props} className="requests-hint">{hint}</span> : undefined
      }} />
      {/* mark top-level keys whose content repeats an earlier request — CSS fades their subtree.
          Always mounted (conditional mounting would register in the store a pass too late) */}
      <JsonView.KeyName render={(props, { keyName, keys }) =>
        keys.length === 1 && live.current.seenKeys?.includes(keyName)
          ? <span {...props} className="requests-seen-key" />
          : undefined
      } />
    </JsonView>
  )
}

// `messages` dominate a request body and grow with the session, so each one is its own
// lazy-mounted tree (like JsonlView's entries) — render cost scales with what's in view.
const Pane = React.memo(function Pane({ value, headers, seen, expandAll }) {
  const [scale, paneRef] = useMouseFontScale('font-scale.requests')
  const findOpen         = useFindActive()
  const messages = !Array.isArray(value) ? value?.messages : null
  const seenKeys = seen ? ['system', 'tools'].filter(k => seen[k]) : null
  const { messages: _, ...bodyNoMsgs } = value || {}
  const [open, close] = Array.isArray(value) ? '[]' : '{}'
  return (
    <div className="requests-pane" ref={paneRef} style={{ '--font-scale': scale }}>
      {headers && (
        <div className="requests-headers">
          <div className="requests-label">Headers</div>
          <Tree value={headers} expandAll={expandAll} collapsed={true} />
        </div>
      )}
      <div className="requests-label">
        Body
        {(seenKeys?.length > 0 || seen?.messages?.some(Boolean)) && (
          <span className="requests-label-hint">Content repeated from earlier requests is faded and collapsed</span>
        )}
      </div>
      {/* the messages are separate lazy-mounted trees, so hand-made `{ … "messages": [ … ] }`
          lines (with the body tree's own root braces hidden) stitch everything back into what
          reads as one JSON document */}
      {value == null ? (
        <div className="requests-pane-empty">Not captured</div>
      ) : (
        <div className="requests-doc" style={vscodeTheme}>
          <span className="bracket">{open}</span>
          <Tree value={messages ? bodyNoMsgs : value} expandAll={expandAll} seenKeys={seenKeys} />
          {messages && (
            <div className="requests-msgs">
              <div><span className="key">"messages"</span><span className="colon">: </span><span className="bracket">[</span></div>
              <div className="items">
                {messages.map((m, i) => (
                  <LazyMount key={i} eager={i < 10} forceMount={findOpen} rootRef={paneRef} placeholderMinHeight={22}
                             className={seen?.messages?.[i] ? 'requests-seen' : undefined}>
                    <Tree value={m} expandAll={expandAll} collapsed={!!seen?.messages?.[i]} />
                  </LazyMount>
                ))}
              </div>
              <span className="bracket">]</span>
            </div>
          )}
          <span className="bracket">{close}</span>
        </div>
      )}
    </div>
  )
})

// Postman-like inspector for the API request logs captured by bin/capture-requests-proxy.mjs:
// a list of the session's requests on the left, the selected request/response JSON on the right.
export default function RequestsView({ sessionId, date, granularity = 'day', fileSize = 0, expandAll = null }) {
  const [records, setRecords]   = useState(null)
  const [selected, setSelected] = useState(0)
  const [tab, setTab]           = useState('request')
  // Non-/v1/messages records carry no body — show the bare record (url/status/model/size) instead.
  const rec     = records?.[selected]
  const body    = useDeferredValue(tab === 'request' ? (rec?.request ?? rec) : rec?.response)
  const headers = useDeferredValue(tab === 'request' ? rec?.requestHeaders : rec?.responseHeaders)
  const seen    = useDeferredValue(tab === 'request' ? rec?.$seen : null)

  // Clear only when the session identity changes; live refetches (fileSize) swap the
  // list in place — records only append, so the selected index stays valid.
  useEffect(() => {
    setRecords(null)
    setSelected(0)
  }, [sessionId, date, granularity])

  // fileSize is the transcript's size — a growth signal for the request log too, since
  // the proxy appends its record around the time the transcript gets the reply.
  useEffect(() => {
    let cancelled = false
    window.api.readRequests(sessionId, date || null, granularity).then(res => {
      if (!cancelled) setRecords(res)
    })
    return () => { cancelled = true }
  }, [sessionId, date, granularity, fileSize])

  if (!records) return <div className="requests-view"><div className="requests-empty">Loading…</div></div>
  if (!records.length) {
    return (
      <div className="requests-view">
        <div className="requests-empty">No captured requests for this session. Requests are recorded only while the capture proxy is running.</div>
      </div>
    )
  }

  return (
    <div className="requests-view">
      <ul className="requests-list">
        {records.map((r, i) => {
          const [method, path] = splitUrl(r.url)
          return (
          <li key={i} className={i > 0 && startsUserTurn(r) ? 'new-turn' : ''}>
            <button type="button" className={i === selected ? 'active' : ''} onClick={() => setSelected(i)}>
              <span className={`requests-method ${method.toLowerCase()}`}>{method}</span>
              <span className="requests-url" title={r.url}>{path}</span>
              <span className={`requests-status ${!r.status || r.status >= 400 ? 'error' : 'ok'}`}>{r.status ?? '—'}</span>
              <span className="requests-meta requests-tokens" title="total tokens (input + output + cache)">{tokens(totalTokens(r))}</span>
              <span className="requests-meta requests-size" title="request + response size">{size(r.reqSize == null && r.resSize == null ? r.size : (r.reqSize || 0) + (r.resSize || 0))}</span>
              <span className="requests-meta">{time(r.timestamp)}</span>
              <span className="requests-meta requests-duration">{duration(r.durationMs)}</span>
            </button>
          </li>
          )
        })}
      </ul>
      <div className="requests-detail">
        <div className="requests-tabs">
          {['request', 'response'].map(t => (
            <button key={t} type="button" className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <Pane value={body} headers={headers} seen={seen} expandAll={expandAll} />
      </div>
    </div>
  )
}
