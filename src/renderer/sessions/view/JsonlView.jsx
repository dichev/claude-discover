import React, { useEffect, useRef, useState } from 'react'
import JsonView from '@uiw/react-json-view'
import { githubDarkTheme } from '@uiw/react-json-view/githubDark'
import './JsonlView.css'

function prune(value, q) {
  if (!value || typeof value !== 'object') {
    return String(value ?? '').toLowerCase().includes(q) ? value : undefined
  }
  const out = Array.isArray(value) ? [] : {}
  for (const [k, v] of Object.entries(value)) {
    const sub = k.toLowerCase().includes(q) ? v : prune(v, q)
    if (sub !== undefined) Array.isArray(out) ? out.push(sub) : (out[k] = sub)
  }
  return Object.keys(out).length ? out : undefined
}

export default function JsonlView({ filePath }) {
  const [text, setText] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const timerRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setText(null); setError(null)
    window.api.readLogFile(filePath).then((res) => {
      if (cancelled) return
      res?.ok ? setText(res.text) : setError(res?.error || 'Failed to read file')
    })
    return () => { cancelled = true }
  }, [filePath])

  const onInput = (e) => {
    const val = e.target.value
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setQuery(val), val ? 500 : 0)
  }

  const q = query.trim().toLowerCase()
  const entries = (text?.split('\n') ?? [])
    .filter(Boolean)
    .map((l) => q ? prune(JSON.parse(l), q) : JSON.parse(l))
    .filter((v) => v !== undefined)

  return (
    <div className="jsonl-viewer">
      <div className="jsonl-viewer-toolbar">
        <input className="jsonl-viewer-search" type="search" placeholder="Filter…" onInput={onInput} />
      </div>
      <div className="jsonl-viewer-body">
        {error && <div className="jsonl-viewer-error">{error}</div>}
        {!text && !error && <div className="jsonl-viewer-loading">Loading…</div>}
        {entries.map((value, i) => (
          <JsonView
            key={`${q}-${i}`}
            value={value}
            style={githubDarkTheme}
            collapsed={q ? false : 1}
            displayDataTypes={false}
            displayObjectSize={false}
            shortenTextAfterLength={0}
            enableClipboard={false}
          />
        ))}
      </div>
    </div>
  )
}
