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

function labelFor(entry) {
  if (!entry || typeof entry !== 'object') return 'entry'
  const type = entry.type || entry.message?.role
  const sub = entry.message?.role && entry.message.role !== type ? `:${entry.message.role}` : ''
  return type ? `${type}${sub}` : 'entry'
}

export default function JsonlView({ filePath }) {
  const [text, setText] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const timerRef = useRef(null)
  const bodyRef = useRef(null)

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

  const scrollTo = (i) => {
    const el = bodyRef.current?.querySelector(`[data-entry="${i}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const q = query.trim().toLowerCase()
  const entries = (text?.split('\n') ?? [])
    .filter(Boolean)
    .map((l) => {
      const parsed = JSON.parse(l)
      const value = q ? prune(parsed, q) : parsed
      return value === undefined ? undefined : { value, label: labelFor(parsed) }
    })
    .filter((e) => e !== undefined)

  return (
    <div className="jsonl-viewer">
      <div className="jsonl-viewer-toolbar">
        <input className="jsonl-viewer-search" type="search" placeholder="Filter…" onInput={onInput} />
      </div>
      <div className="jsonl-viewer-content">
        {entries.length > 0 && (
          <ul className="jsonl-viewer-toc">
            {entries.map(({ label }, i) => (
              <li key={i}>
                <button type="button" onClick={() => scrollTo(i)} title={label}>
                  <span className="jsonl-viewer-toc-index">{i + 1}</span>
                  <span className="jsonl-viewer-toc-label">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="jsonl-viewer-body" ref={bodyRef}>
          {error && <div className="jsonl-viewer-error">{error}</div>}
          {!text && !error && <div className="jsonl-viewer-loading">Loading…</div>}
          {entries.map(({ value }, i) => (
            <div key={`${q}-${i}`} data-entry={i} className="jsonl-viewer-entry">
              <JsonView
                value={value}
                style={githubDarkTheme}
                collapsed={q ? false : 2}
                displayDataTypes={false}
                displayObjectSize={false}
                shortenTextAfterLength={0}
                enableClipboard={false}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
