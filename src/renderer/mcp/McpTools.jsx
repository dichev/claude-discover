import { Fragment, memo, useEffect, useEffectEvent, useState } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { ChevronRight, RotateCw, Wrench, X } from 'lucide-react'
import Markdown from '../ui/Markdown.jsx'
import { ErrorMessage } from '../ui/Errors.jsx'
import { closeFind } from '../ui/useFindActive.js'
import { countTokens } from '../../shared/tokenizer/claudeTokenizer.js'
import { fmtCompact } from '../utils/formatting.js'
import './McpTools.css'

// The arguments a tool starts with: every one it takes, blank but those `preset` has
const template = (schema, preset) => JSON.stringify(Object.fromEntries(Object.keys(schema.properties ?? {}).map(k => [k, preset[k] ?? ''])), null, 2)

// A blank argument is one left out, or an optional number would fail its schema as ""
const filled = args => Object.fromEntries(Object.entries(args).filter(([, v]) => v !== ''))
const BLANK  = /^\s*"[^"]*":\s*""\s*,?\s*$/ // a `"name": ""` line, which the call leaves out

// The context a tool takes in every request, sent as the API's tool definition
const toolTokens = t => countTokens(JSON.stringify({ name: t.name, description: t.description, input_schema: t.inputSchema }))
// Claude Code defers the rest to a search by name, so they take context only once loaded
const alwaysLoaded = t => !!t._meta?.['anthropic/alwaysLoad']

const Tool = memo(function Tool({ tool, tokens, picked, onPick }) {
  const required = tool.inputSchema.required ?? []
  const readOnly = !!tool.annotations?.readOnlyHint
  const hints    = Object.entries(tool.annotations ?? {}).map(([name, value]) => `${name}: ${value}`).join(' · ') // as the server sent them
  return (
    <details className={`mcp-tool-card${picked ? ' picked' : ''}`}>
      {/* the row picks the tool as it opens or closes it; what's under it is text to select */}
      <summary className="mcp-tool-name" onClick={() => onPick(tool.name)}>
        <ChevronRight size={14} className="mcp-tool-chevron" />
        {tool.name}
        {alwaysLoaded(tool)
          ? <span className="mcp-tool-loaded" data-tooltip-content="In a session's context from its start, not deferred to a tool search">always loaded</span>
          : <span className="mcp-tool-loaded deferred" data-tooltip-content="In a session's context only once a tool search loads it">deferred</span>}
        <span className={`mcp-tool-hint${readOnly ? '' : ' acts'}`} data-tooltip-content={hints}>{readOnly ? 'read-only' : 'not read-only'}</span>
        <span className="mcp-tool-tokens">~{fmtCompact(tokens)}</span>
      </summary>
      <p className="mcp-tool-description">{tool.description}</p>
      <table className="mcp-tool-params">
        <thead>
          <tr><th>Argument</th><th>Type</th><th>Default</th><th>Description</th></tr>
        </thead>
        <tbody>
          {Object.entries(tool.inputSchema.properties ?? {}).map(([name, p]) => (
            <tr key={name}>
              <td><code>{name}</code>{required.includes(name) && <span className="mcp-required">*</span>}</td>
              <td className="mcp-param-type">{p.enum?.join(' | ') ?? p.type}</td>
              <td className="mcp-param-type">{p.default !== undefined && JSON.stringify(p.default)}</td>
              <td>{p.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
})

// The picked tool's arguments, its Run button and its answer
function ToolCall({ tool, preset }) {
  const [args, setArgs]       = useState(() => template(tool.inputSchema, preset))
  const [result, setResult]   = useState(null) // { text, isError, ms } | { error }
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    const start = performance.now()
    try {
      const res = await window.api.callMcpTool(tool.name, filled(JSON.parse(args)))
      setResult({ ...res, ms: Math.round(performance.now() - start) })
    } catch (error) {
      setResult({ error })
    }
    setRunning(false)
  }

  return (
    <div className="mcp-call">
      <code className="mcp-tool-name">{tool.name}</code>
      {/* A see-through textarea over the same text drawn in a <pre>, so blank arguments can be grayed; the <pre> sizes both */}
      <div className="mcp-args">
        <pre aria-hidden>
          {args.split('\n').map((line, i) => <Fragment key={i}>{i > 0 && '\n'}<span className={BLANK.test(line) ? 'blank' : undefined}>{line}</span></Fragment>)}
          {' '}
        </pre>
        <textarea
          value={args}
          onChange={e => setArgs(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !running) run() }}
          spellCheck={false}
        />
        <button type="button" className="button-primary" onClick={run} disabled={running} data-tooltip-content="Ctrl+Enter">{running ? 'Running…' : 'Run'}</button>
      </div>
      {result?.error && <ErrorMessage title="Call failed" error={result.error} />}
      {result?.text != null && <>
        <div className="mcp-call-stats">{result.isError ? 'Tool error · ' : ''}{result.ms} ms · {fmtCompact(result.text.length)} chars · ~{fmtCompact(countTokens(result.text))} tokens</div>
        <div className={`mcp-call-result${result.isError ? ' mcp-call-error' : ''}`}>
          <Markdown text={result.text} autoFence />
        </div>
      </>}
    </div>
  )
}

// Whether the panel takes the detail pane, as [shown, show]: opened from the View menu or by `show(true)`, until `show(false)`
export function useMcpTools() {
  const [shown, setShown] = useState(false)
  const show   = on => { closeFind(); setShown(on) }
  const onMenu = useEffectEvent(() => show(true))
  useEffect(() => window.api.onShowMcpTools(onMenu), [])
  return [shown, show]
}

// Debug panel for the app's MCP server: the tools it serves, listed and run over HTTP as Claude Code sees them.
// `session` is the id a tool's `session` argument starts with
export default function McpTools({ session, onClose }) {
  const [listing, setListing]              = useState(null) // { url, instructions, tools } | { error }
  const [reload, setReload]                = useState(0)
  const [picked, setPicked]                = useState(null)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'mcp-tools', panelIds: ['mcp-schemas', 'mcp-call'], storage: localStorage })
  const tool         = listing?.tools?.find(t => t.name === picked) ?? listing?.tools?.[0]
  const sizes        = listing?.tools?.map(toolTokens) ?? []
  const instructions = countTokens(listing?.instructions)
  const loaded       = sizes.reduce((sum, n, i) => alwaysLoaded(listing.tools[i]) ? sum + n : sum, 0)
  const deferred     = sizes.reduce((sum, n) => sum + n, 0) - loaded

  useEffect(() => {
    let cancelled = false
    window.api.listMcpTools().then(l => !cancelled && setListing(l), error => !cancelled && setListing({ error }))
    return () => { cancelled = true }
  }, [reload])

  return (
    <div className="mcp-tools">
      <header className="section-title mcp-tools-header">
        <Wrench size={18} className="section-title-icon" />
        <h2 className="section-title-text">MCP tools</h2>
        <span className="section-title-caption">{listing?.url}</span>
        <button type="button" className="section-title-button" onClick={() => setReload(n => n + 1)} aria-label="Reload tools" data-tooltip-content="Reload tools">
          <RotateCw size={16} />
        </button>
        <button type="button" className="section-title-button" onClick={onClose} aria-label="Close" data-tooltip-content="Close">
          <X size={16} />
        </button>
      </header>
      {!listing && <div className="empty">Loading…</div>}
      {listing?.error && <ErrorMessage title="Couldn't list the tools" error={listing.error} />}
      {tool && (
        <Group orientation="horizontal" disableCursor className="mcp-tools-body" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
          <Panel id="mcp-schemas" minSize={250} className="mcp-tools-pane">
            <div className="mcp-tools-size">
              instructions ~{fmtCompact(instructions)} + always loaded tools ~{fmtCompact(loaded)} + deferred tools ~{fmtCompact(deferred)}
              {' = '}~{fmtCompact(instructions + loaded + deferred)}
            </div>
            {listing.instructions && <p className="mcp-tools-instructions">{listing.instructions}</p>}
            {listing.tools.map((t, i) => <Tool key={t.name} tool={t} tokens={sizes[i]} picked={t === tool} onPick={setPicked} />)}
          </Panel>
          <Separator className="resize-handle resize-handle-v" />
          <Panel id="mcp-call" minSize={250} className="mcp-tools-pane">
            <ToolCall key={tool.name} tool={tool} preset={{ session }} />
          </Panel>
        </Group>
      )}
    </div>
  )
}
