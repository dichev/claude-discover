import React, { useRef, useState } from 'react'
import JsonView from '@uiw/react-json-view'
import { githubDarkTheme } from '@uiw/react-json-view/githubDark'
import LazyMount from '../../ui/LazyMount.jsx'
import './JsonlView.css'

function highlight(text, q) {
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return String(text ?? '').split(new RegExp(`(${escaped})`, 'i'))
    .map((p, i) => i % 2 ? <mark key={i} className="jsonl-viewer-mark">{p}</mark> : p)
}

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

// Event types we synthesize ourselves (via the InstructionsLoaded hook etc.), not produced by Claude Code.
const CUSTOM_EVENT_TYPES = new Set(['instructions-loaded'])

function labelFor(entry) {
  if (!entry || typeof entry !== 'object') return 'entry'
  const type = entry.type || entry.message?.role
  if (!type) return 'entry'
  const sub = entry.memory_type ?? (entry.message?.role !== type ? entry.message?.role : null)
  return sub ? `${type}:${sub}` : type
}

export default function JsonlView({ items }) {
  const [query, setQuery] = useState('')
  const bodyRef = useRef(null)

  const scrollTo = (i) => {
    const el = bodyRef.current?.querySelector(`[data-entry="${i}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const q = query.trim().toLowerCase()
  const entries = (items ?? [])
    .map((parsed) => {
      const value = q ? prune(parsed, q) : parsed
      return value === undefined ? undefined : { value, label: labelFor(parsed), isCustom: CUSTOM_EVENT_TYPES.has(parsed?.type) }
    })
    .filter((e) => e !== undefined)

  return (
    <div className="jsonl-viewer">
      <div className="jsonl-viewer-toolbar">
        <input className="jsonl-viewer-search" type="search" placeholder="Filter…" onInput={(e) => setQuery(e.target.value)} />
      </div>
      <div className="jsonl-viewer-content">
        {entries.length > 0 && (
          <ul className="jsonl-viewer-toc">
            {entries.map(({ label, isCustom }, i) => (
              <li key={i}>
                <button type="button" onClick={() => scrollTo(i)} title={isCustom ? `${label} (custom event)` : label} className={isCustom ? 'jsonl-viewer-toc-custom' : ''}>
                  <span className="jsonl-viewer-toc-index">{i + 1}</span>
                  <span className="jsonl-viewer-toc-label">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="jsonl-viewer-body" ref={bodyRef}>
          {!items && <div className="jsonl-viewer-loading">Loading…</div>}
          {entries.map(({ value }, i) => (
            <LazyMount key={`${q}-${i}`} eager={i < 8} data-entry={i} className="jsonl-viewer-entry">
              <JsonView
                value={value}
                style={githubDarkTheme}
                collapsed={q ? false : 2}
                displayDataTypes={false}
                displayObjectSize={false}
                shortenTextAfterLength={0}
                enableClipboard={false}
              >
                <JsonView.String render={({ children, ...rest }, { type }) => q && type === 'value'
                  ? <span {...rest}>"{highlight(children, q)}"</span>
                  : undefined
                } />
                <JsonView.KeyName render={({ children, ...rest }) => q
                  ? <span {...rest}>{highlight(children, q)}</span>
                  : undefined
                } />
              </JsonView>
            </LazyMount>
          ))}
        </div>
      </div>
    </div>
  )
}
