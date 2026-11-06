import { Fragment } from 'react'
import { Plug } from 'lucide-react'
import { fmtNum, plural } from '../../utils/formatting.js'
import './McpConnections.css'

const ms = n => n === null ? '—' : `${fmtNum(n)}ms`

const READY_TIP = 'Connect time: at most this long. It was still connecting at an earlier request and ready at this one'

const label = status => status.replace('-', ' ')

const counts = servers => Object.entries(Object.groupBy(servers, s => s.status)).map(([status, list]) => `${list.length} ${label(status)}`).join(', ')

// "4 connected, 1 failed" — a change block counts only what changed since the one above
export function McpTitle({ turn }) {
  return <span className="mcp-title"><Plug className="mcp-icon" /> MCP servers: {counts(turn.servers)}</span>
}

// The MCP servers one turn had, from the transcript's requests
export default function McpConnections({ turn }) {
  return (
    <table className="mcp-servers">
      <colgroup><col /><col className="mcp-col-time" /><col /></colgroup>
      <tbody>
        {turn.servers.map(s => (
          <Fragment key={s.name}>
            <tr>
              <td>
                {s.name}
                {s.toolCount != null && <span className="mcp-dim"> ({plural(s.toolCount, 'tool')})</span>}
              </td>
              {s.readyWithin != null ? <td className="mcp-ms" data-tooltip-content={READY_TIP}>≤ {ms(s.readyWithin)}</td> : <td />}
              <td className={`mcp-status ${s.status}`}>{label(s.status)}</td>
            </tr>
            {s.error && <tr><td colSpan={3}><pre className="mcp-error">{s.error}</pre></td></tr>}
            {s.groups.map(g => (
              <tr key={g.name} className="mcp-dim">
                <td colSpan={3} className="mcp-tool">↳ {g.name} ({plural(g.toolCount, 'tool')})</td>
              </tr>
            ))}
            {s.tools.map((t, j) => (
              <tr key={j} className="mcp-dim">
                <td className="mcp-tool">↳ {t.name}{t.error && <span className="mcp-tool-error"> · {t.error}</span>}</td>
                <td className="mcp-ms">{ms(t.ms)}</td>
                <td />
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
