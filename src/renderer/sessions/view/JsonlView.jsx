import React, { useState } from 'react'
import JsonView from '@uiw/react-json-view'
import { vscodeTheme } from '@uiw/react-json-view/vscode'
import LazyMount from '../../ui/LazyMount.jsx'
import { useFindActive } from '../../ui/useFindActive.js'
import { renderShortened } from '../../ui/ShortText.jsx'
import { useMouseFontScale } from '../../utils/useMouse.js'
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

function labelFor(entry) {
  if (!entry || typeof entry !== 'object') return 'entry'
  const type = entry.type || entry.message?.role
  if (!type) return 'entry'
  const sub = entry.message?.role !== type ? entry.message?.role : null
  return sub ? `${type}:${sub}` : type
}

export default function JsonlView({ items, expandAll = null }) {
  const [query, setQuery] = useState('')
  const [scale, bodyRef]  = useMouseFontScale('font-scale.jsonl')
  const findOpen          = useFindActive()

  const scrollTo = (i) => {
    const el = bodyRef.current?.querySelector(`[data-entry="${i}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const q = query.trim().toLowerCase()
  const entries = (items ?? [])
    .map((parsed) => {
      const value = q ? prune(parsed, q) : parsed
      return value === undefined ? undefined : { value, label: labelFor(parsed) }
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
        <div className="jsonl-viewer-body" ref={bodyRef} style={{ '--font-scale': scale }}>
          {!items && <div className="jsonl-viewer-loading">Loading…</div>}
          {entries.map(({ value }, i) => (
            <LazyMount key={`${q}-${i}`} eager={i < 8} forceMount={findOpen} data-entry={i} className="jsonl-viewer-entry">
              <JsonView
                value={value}
                style={vscodeTheme}
                collapsed={false} // fully expanded by default — lazy mount + string shortening keep it affordable
                displayDataTypes={false}
                displayObjectSize={false}
                shortenTextAfterLength={0} // shortening is ours (see ui/ShortText.jsx); filtering and the toggle turn it off
                highlightUpdates={false}
                enableClipboard={false}
              >
                <JsonView.String render={({ children, ...rest }, ctx) => q && ctx.type === 'value'
                  ? <span {...rest}>"{highlight(children, q)}"</span>
                  : renderShortened(!q && !expandAll)({ children, ...rest }, ctx)
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
