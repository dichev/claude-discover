import { useState } from 'react'
import { Info } from 'lucide-react'
import { fmtCompact, tone } from '../../utils/formatting.js'
import { THRESHOLDS } from '../../utils/thresholds.js'
import ProgressBar from '../../ui/ProgressBar.jsx'
import './ContextUsage.css'

const COLORS = { messages: '#3987e5', systemTools: '#d95926', mcpTools: '#199e70', prompt: '#c98500' }
const OTHER_COLOR = 'var(--text-dim)'

// Where the rows read differently from Claude's own /context (Claude Desktop's panel, see contextParts.js), and how they're sized
const NOTE = [
  "Note: Claude's /context takes Skills out of System tools and still counts them in Messages, while here they're counted once, in Skills",
  'Token counts are estimated offline, to save a token-counting request to the API',
].join('\n')

// An info icon tipping how the breakdown's rows differ from Claude's own /context, for beside its title
export function ContextInfo() {
  return <Info className="context-info" size={11} data-tooltip-content={NOTE} />
}

// How full the window (`limit`) is at `size` tokens, as a bar; `note` tips it
export function ContextFill({ size, limit, note }) {
  return (
    <div className="context-window" data-tooltip-content={note}>
      <ProgressBar pct={size / limit * 100} tone={tone(size, THRESHOLDS.context)} />
    </div>
  )
}

// What fills the context, in Claude Desktop's categories, as bars on one scale; a category's parts expand in place.
// No autocompact buffer or free space: where a session compacts depends on its settings, which the transcript doesn't log.
// The last row is the tokens `compacted` away (see compactedTokens): a negative count, off the bars' scale, so it has none
export default function ContextUsage({ parts, compacted }) {
  const [expanded, setExpanded] = useState({})
  const max    = Math.max(...parts.map(p => p.tokens))
  const toggle = key => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  // A row's name tips its own text while that's cut off
  const row = (key, name, tokens, { className = '', color, chevron, onClick }) => (
    <div key={key} className={`context-row ${className}`} onClick={onClick}>
      <span className="context-name" data-tooltip-content={name} data-tooltip-place="bottom" data-tooltip-delay-show={800} data-tip-if-truncated>{chevron && <span className="context-chevron">{chevron}</span>}{name}</span>
      <span className="context-track"><span className="context-fill" style={{ width: `${tokens / max * 100}%`, background: color }} /></span>
      <span className="context-tokens">{fmtCompact(tokens)}</span>
    </div>
  )
  return (
    <div className="context-usage">
      {parts.flatMap(p => {
        const color = COLORS[p.key] ?? OTHER_COLOR
        if (p.children.length < 2) return [row(p.key, p.name, p.tokens, { color })]
        const open = expanded[p.key]
        return [
          row(p.key, p.name, p.tokens, { className: 'expands', color, chevron: open ? '▾' : '▸', onClick: () => toggle(p.key) }),
          ...open ? p.children.map(c => row(`${p.key}/${c.name}`, c.name, c.tokens, { className: 'part', color })) : [],
        ]
      })}
      {compacted > 0 && (
        <div className="context-row part">
          <span className="context-name" data-tooltip-content="The tokens compactions took out of the context">Compacted away</span>
          <span />
          <span className="context-tokens">{fmtCompact(-compacted)}</span>
        </div>
      )}
    </div>
  )
}
