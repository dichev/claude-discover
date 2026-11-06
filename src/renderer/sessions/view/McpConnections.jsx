import { Database } from 'lucide-react'
import { fmtNum, plural } from '../../utils/formatting.js'
import Markdown from '../../ui/Markdown.jsx'
import ApproxTokens from './ApproxTokens.jsx'
import { countTokens } from './transcript.js'
import { useCollapsed } from './useCollapsed.js'
import './McpConnections.css'

const ms = n => n === null ? '—' : `${fmtNum(n)}ms`

const RUN_WITH_DEBUG = 'Run with --debug (debug: true in the Agent SDK) to see it'
const TRANSPORT_TIP = `Transport: how this server connects (stdio, http, …). ${RUN_WITH_DEBUG}`
const TIME_TIP = `Connect time: how long this server took to connect. ${RUN_WITH_DEBUG}`
const READY_TIP = 'Connect time: at most this long. It was still connecting at an earlier request and ready at this one'
const VERSION_TIP = 'The version this server reported when it connected'
const CACHED_TIP = 'Connected from a cache: the server tagged its version +cached'
const INSTRUCTIONS_TIP = "Approx. tokens of this server's instructions. Click the row to read them"

const label = status => status.replace('-', ' ')

const counts = servers => Object.entries(Object.groupBy(servers, s => s.status)).map(([status, list]) => `${list.length} ${label(status)}`).join(', ')

// "4 connected, 1 failed" — a change block counts only what changed since the one above
export function McpTitle({ servers }) {
  // stdio starts a process per turn, http connects to one already running, sdk runs in the SDK host's own process
  const started = servers.filter(s => s.transport === 'stdio').length
  return (
    <span className="mcp-title">
      MCP servers: {counts(servers)}{started > 0 && ` · ${started} ${started === 1 ? 'process' : 'processes'} started`}
    </span>
  )
}

// The MCP servers one turn had: from the transcript's requests, or connected per the session's debug log (McpDebugLog).
// `instructions`: each server's own { content, model }, by its name
export default function McpConnections({ turn, instructions }) {
  return (
    <table className="mcp-servers">
      {/* fixed-width columns, so a block without a transport, time or tokens lines up with one with; the name takes the rest */}
      <colgroup><col /><col className="mcp-col-transport" /><col className="mcp-col-time" /><col className="mcp-col-status" /><col className="mcp-col-tokens" /></colgroup>
      <tbody>
        {turn.servers.map(s => <Server key={s.name} s={s} debug={turn.debug} instructions={instructions?.get(s.name)} gutter={instructions?.size > 0} />)}
      </tbody>
    </table>
  )
}

// `gutter`: some server in the table folds, so the names leave room for its chevron
function Server({ s, debug, instructions, gutter }) {
  const [open, setOpen] = useCollapsed(false)
  return (
    <>
      <tr className={instructions && 'mcp-foldable'} onClick={instructions && (() => setOpen(v => !v))}>
        <td>
          {gutter && <button className={`mcp-chevron${instructions ? '' : ' none'}`} aria-expanded={open} aria-label="Instructions">{open ? '▾' : '▸'}</button>}
          {s.name}
          {s.toolCount != null && <span className="mcp-dim"> ({plural(s.toolCount, 'tool')})</span>}
          {s.version && <span className="mcp-version" data-tooltip-content={VERSION_TIP}>{s.version}</span>}
        </td>
        <td className="mcp-dim" data-tooltip-content={debug ? undefined : TRANSPORT_TIP}>{s.transport ?? '—'}</td>
        {s.readyWithin != null
          ? <td className="mcp-ms" data-tooltip-content={READY_TIP}>≤ {ms(s.readyWithin)}</td>
          : <td className="mcp-ms" data-tooltip-content={debug ? undefined : TIME_TIP}>{s.cached && <span className="mcp-cached" data-tooltip-content={CACHED_TIP}><Database /></span>}{ms(s.ms)}</td>}
        <td className={`mcp-status ${s.status}`}>{label(s.status)}</td>
        <td className="mcp-tokens">{instructions && <ApproxTokens tokens={countTokens(instructions.content, instructions.model)} tip={INSTRUCTIONS_TIP} />}</td>
      </tr>
      {(s.error || s.stderr.length > 0) && (
        <tr><td colSpan={5}><pre className={`mcp-error ${s.status}`}>{[s.error, ...s.stderr].filter(Boolean).join('\n')}</pre></td></tr>
      )}
      {open && instructions && <tr><td colSpan={5} className="mcp-tool"><div className="aux-body"><Markdown className="block-text" text={instructions.content} /></div></td></tr>}
      {s.groups.map(g => (
        <tr key={g.name} className="mcp-dim">
          <td colSpan={5} className="mcp-tool">↳ {g.name} ({plural(g.toolCount, 'tool')})</td>
        </tr>
      ))}
      {s.tools.map((t, j) => (
        <tr key={j} className="mcp-dim">
          <td colSpan={2} className="mcp-tool">↳ {t.name}{t.error && <span className="mcp-tool-error"> · {t.error}</span>}</td>
          <td className="mcp-ms">{ms(t.ms)}</td>
          <td colSpan={2} />
        </tr>
      ))}
    </>
  )
}
