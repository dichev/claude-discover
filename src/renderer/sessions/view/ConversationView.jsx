import React, { useContext, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Terminal } from 'lucide-react'
import { fmtCompact, fmtDuration } from '../../utils/formatting'
import { THRESHOLDS as T } from '../../utils/thresholds.js'
import { flatten, groupTurns, cycleDurations, tokenPoints, isContextTurn, toolSummary, parseCommand } from './transcript.js'
import LazyMount from '../../ui/LazyMount.jsx'
import Markdown from '../../ui/Markdown.jsx'
import { useFindActive } from '../../ui/useFindActive.js'
import './ConversationView.css'

// Global expand/collapse signal: null = leave each collapsible on its own state,
// true/false = force open/closed. Changing it re-applies to every collapsible.
const ExpandAllContext = React.createContext(null)

function useCollapsed(defaultOpen) {
  const [open, setOpen] = useState(defaultOpen)
  const expandAll       = useContext(ExpandAllContext)
  useEffect(() => { if (expandAll != null) setOpen(expandAll) }, [expandAll])
  return [open, setOpen]
}

// Slash-command invocation (`<command-name>…`): meta for most purposes, but still a user action.
const isCommandTurn = t => t.blocks.some(b => b.type === 'text' && parseCommand(b.text)?.name)


export default function ConversationView({ items, instructions = [], expandAll = null }) {
  const turns     = useMemo(() => flatten(items, instructions), [items, instructions])
  const groups    = useMemo(() => groupTurns(turns), [turns])
  const points    = useMemo(() => tokenPoints(groups), [groups])
  const durations = useMemo(() => cycleDurations(groups), [groups])
  const findOpen  = useFindActive()
  const hasTimeline = points.some(Boolean)
  return (
    <ExpandAllContext.Provider value={expandAll}>
      <div className={`conversation${hasTimeline ? ' has-token-timeline' : ''}`}>
        {groups.map((g, i) => (
          <div className={`conv-row conv-row-${g.kind}`} key={g.kind === 'instruction' ? g.turn.uuid : g.turns[0].uuid}>
            <LazyMount eager={i < 8} forceMount={findOpen} placeholderMinHeight={80}>
              {g.kind === 'user'      ? <UserRow turns={g.turns} point={points[i]} />
               : g.kind === 'assistant' ? <AssistantCard turns={g.turns} point={points[i]} duration={durations[i]} showAuthor={groups[i - 1]?.kind !== 'assistant'} />
               :                        <InstructionFile it={g.turn.blocks[0].it} showNote={groups[i - 1]?.kind !== 'instruction'} />}
            </LazyMount>
            {points[i] ? <TokenPoint point={points[i]} />
             // Commands consume no tokens so they never get a real point — mark them with a plain dot.
             : hasTimeline && g.kind === 'user' && g.turns.some(isCommandTurn) && <TokenPoint point={{ role: 'command', delta: 0 }} />}
          </div>
        ))}
      </div>
    </ExpandAllContext.Provider>
  )
}

// Anthropic's official Claude sunburst mark, in the brand's clay-orange.
const ClaudeIcon = () => (
  <svg className="msg-icon claude-icon" viewBox="0 0 1200 1200">
    <path fill="#d97757" d="M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647 L 468.644287 650.738403 L 457.208069 650.738403 L 417.986633 648.322144 L 283.892639 644.69812 L 167.597321 639.865845 L 54.926208 633.825623 L 26.577238 627.785339 L 3.3e-05 592.751709 L 2.73832 575.27533 L 26.577238 559.248352 L 60.724873 562.228149 L 136.187973 567.382629 L 249.422867 575.194763 L 331.570496 580.026978 L 453.261841 592.671082 L 472.590637 592.671082 L 475.328857 584.859009 L 468.724915 580.026978 L 463.570557 575.194763 L 346.389313 495.785217 L 219.543671 411.865906 L 153.100723 363.543762 L 117.181267 339.060425 L 99.060455 316.107361 L 91.248367 266.01355 L 123.865784 230.093994 L 167.677887 233.073853 L 178.872513 236.053772 L 223.248367 270.201477 L 318.040283 343.570496 L 441.825592 434.738342 L 459.946411 449.798706 L 467.194672 444.64447 L 468.080597 441.020203 L 459.946411 427.409485 L 392.617493 305.718323 L 320.778564 181.932983 L 288.80542 130.630859 L 280.348999 99.865845 C 277.369171 87.221436 275.194641 76.590698 275.194641 63.624268 L 312.322174 13.20813 L 332.8591 6.604126 L 382.389313 13.20813 L 403.248352 31.328979 L 434.013519 101.71814 L 483.865753 212.537048 L 561.181274 363.221497 L 583.812134 407.919434 L 595.892639 449.315491 L 600.40271 461.959839 L 608.214783 461.959839 L 608.214783 454.711609 L 614.577271 369.825623 L 626.335632 265.61084 L 637.771851 131.516846 L 641.718201 93.745117 L 660.402832 48.483276 L 697.530334 24.000122 L 726.52356 37.852417 L 750.362549 72 L 747.060486 94.067139 L 732.886047 186.201416 L 705.100708 330.52356 L 686.979919 427.167847 L 697.530334 427.167847 L 709.61084 415.087341 L 758.496704 350.174561 L 840.644348 247.490051 L 876.885925 206.738342 L 919.167847 161.71814 L 946.308838 140.29541 L 997.61084 140.29541 L 1035.38269 196.429626 L 1018.469849 254.416199 L 965.637634 321.422852 L 921.825562 378.201538 L 859.006714 462.765259 L 819.785278 530.41626 L 823.409424 535.812073 L 832.75177 534.92627 L 974.657776 504.724915 L 1051.328979 490.872559 L 1142.818848 475.167786 L 1184.214844 494.496582 L 1188.724854 514.147644 L 1172.456421 554.335693 L 1074.604126 578.496765 L 959.838989 601.449829 L 788.939636 641.879272 L 786.845764 643.409485 L 789.261841 646.389343 L 866.255127 653.637634 L 899.194702 655.409424 L 979.812134 655.409424 L 1129.932861 666.604187 L 1169.154419 692.537109 L 1192.671265 724.268677 L 1188.724854 748.429688 L 1128.322144 779.194641 L 1046.818848 759.865845 L 856.590759 714.604126 L 791.355774 698.335754 L 782.335693 698.335754 L 782.335693 703.731567 L 836.69812 756.885986 L 936.322205 846.845581 L 1061.073975 962.81897 L 1067.436279 991.490112 L 1051.409424 1014.120911 L 1034.496704 1011.704712 L 924.885986 929.234924 L 882.604126 892.107544 L 786.845764 811.48999 L 780.483276 811.48999 L 780.483276 819.946289 L 802.550415 852.241699 L 919.087341 1027.409424 L 925.127625 1081.127686 L 916.671204 1098.604126 L 886.469849 1109.154419 L 853.288696 1103.114136 L 785.073914 1007.355835 L 714.684631 899.516785 L 657.906067 802.872498 L 650.979858 806.81897 L 617.476624 1167.704834 L 601.771851 1186.147705 L 565.530212 1200 L 535.328857 1177.046997 L 519.302124 1139.919556 L 535.328857 1066.550537 L 554.657776 970.792053 L 570.362488 894.68457 L 584.536926 800.134277 L 592.993347 768.724976 L 592.429626 766.630859 L 585.503479 767.516968 L 514.22821 865.369263 L 405.825531 1011.865906 L 320.053711 1103.677979 L 299.516815 1111.812256 L 263.919525 1093.369263 L 267.221497 1060.429688 L 287.114136 1031.114136 L 405.825531 880.107361 L 477.422913 786.52356 L 523.651062 732.483276 L 523.328918 724.671265 L 520.590698 724.671265 L 205.288605 929.395935 L 149.154434 936.644409 L 124.993355 914.01355 L 127.973183 876.885986 L 139.409409 864.80542 L 234.201385 799.570435 L 233.879227 799.8927 Z" />
  </svg>
)

const CTX_LIMIT = T.context.danger // bar scale: fraction of a full context window

// Sits in the conversation's right gutter at the row's own position, so it scrolls with
// the content — no scroll syncing or measurement needed. Just a dot; the numbers it used
// to show in a tooltip now live in the assistant card header instead.
function TokenPoint({ point: p }) {
  return (
    <div className={`token-point token-point-${p.role}${p.delta < 0 ? ' negative' : ''}`}>
      <span className="token-point-dot" />
    </div>
  )
}

// Total-tokens figure, shared by user and assistant headers. Its tooltip (tippy renders
// title attributes as HTML, see main.jsx) carries the context bar, the turn's usage
// breakdown (labels/formulas mirror SessionSummary's Tokens section) and the running total.
function TokenStats({ point }) {
  if (!point) return null
  const rows = []
  if (point.ctx != null) {
    const width = Math.min(point.ctx / CTX_LIMIT, 1) * 100
    rows.push(`<div class="token-tooltip-ctx">Context <span class="token-point-ctx-bar"><span style="width:${width}%"></span></span> <span class="token-tooltip-ctx-val">${fmtCompact(point.ctx)}</span></div>`)
  }
  const u = point.usage
  if (u) {
    const cells = [
      ['Input', fmtCompact(u.input)],
      ['Output', fmtCompact(u.output)],
      ['Cache write (5m)', fmtCompact(u.cacheCreation5m)],
      ['Cache write (1h)', fmtCompact(u.cacheCreation1h)],
      ['Cache read', fmtCompact(u.cacheRead)],
    ]
    // Turn total: unlabeled sum row, its top border draws the "adding-up" line over the values column.
    const sum = `<span></span><span class="token-tooltip-sum">+${fmtCompact(u.input + u.output + u.cacheRead + u.cacheCreation)}</span>`
    rows.push(`<div class="token-tooltip-grid">${cells.map(([l, v]) => `<span>${l}</span><span>${v}</span>`).join('')}${sum}</div>`)
  }
  rows.push(`<div class="token-tooltip-total"><span>Accumulated tokens</span><span>${fmtCompact(point.total)}</span></div>`)
  return (
    <span className="msg-tokens" title={`<div class="token-tooltip">${rows.join('')}</div>`}>
      {fmtCompact(point.total)}
    </span>
  )
}

function UserRow({ turns, point }) {
  const [open, setOpen] = useCollapsed(false)
  const msg             = turns.find(t => !isContextTurn(t))
  const ctxItems        = turns.filter(isContextTurn).flatMap(t => t.blocks)

  // Slash commands are meta (CLI-injected records) but keep the header; other meta notes or
  // orphan context with no real message render plainly, without a header (as before).
  if (!msg || (msg.isMeta && !isCommandTurn(msg))) return <>{turns.map(t => <TurnRow key={t.uuid} turn={t} />)}</>

  return (
    <div className="msg-user">
      <div className="msg-header">
        <Terminal className="msg-icon" />
        <span className="msg-author">You</span>
        {ctxItems.length > 0 && (
          <button className="msg-summary" onClick={() => setOpen(v => !v)}>
            <span className="aux-chevron">{open ? '▾' : '▸'}</span>
            <span>attachments · {ctxItems.length} item{ctxItems.length === 1 ? '' : 's'}</span>
          </button>
        )}
        <span className="msg-header-right">
          <TokenStats point={point} />
          {msg.ts != null && <span className="msg-time">{format(msg.ts, 'HH:mm:ss')}</span>}
        </span>
      </div>
      {open && ctxItems.length > 0 && (
        <div className="msg-context">
          {ctxItems.map((b, i) => <Attachment key={i} att={b.attachment} />)}
        </div>
      )}
      <TurnRow turn={msg} />
    </div>
  )
}

function AssistantCard({ turns, point, duration, showAuthor = true }) {
  const [open, setOpen] = useCollapsed(false)
  const toolBlocks = turns.flatMap(t => t.blocks.filter(b => b.type === 'tool_use'))
  const errorCount = toolBlocks.filter(b => b.result?.is_error).length
  const isAux      = t => !t.blocks.some(b => b.type === 'text')
  // Aux turns (tool calls, thinking-only, meta) fold behind the header chevron; without
  // any tool calls there is nothing worth hiding, so everything stays visible.
  const foldable   = toolBlocks.length > 0 && turns.some(isAux)
  const end        = turns.findLast(t => t.ts != null)?.ts ?? null
  // Once opened, keep aux turns mounted while folded (hidden via CSS) so each tool's expanded state
  // survives a fold/unfold. Never-opened cards stay unmounted so we don't eagerly render every tool.
  const [everOpen, setEverOpen] = useState(false)
  useEffect(() => { if (open) setEverOpen(true) }, [open])
  const hidden     = t => !open && foldable && isAux(t)
  const anyVisible = turns.some(t => !hidden(t))
  const parts = [
    toolBlocks.length > 0 && `${toolBlocks.length} tool call${toolBlocks.length === 1 ? '' : 's'}`,
    errorCount > 0 && <span key="err" className="msg-errors">{errorCount} error{errorCount === 1 ? '' : 's'}</span>,
  ].filter(Boolean)
  const summary = parts.map((p, i) => <React.Fragment key={i}>{i > 0 && ', '}{p}</React.Fragment>)
  return (
    <div className="assistant-card">
      <div className="msg-header">
        {showAuthor && <ClaudeIcon />}
        {showAuthor && <span className="msg-author">Claude</span>}
        {parts.length > 0 && (foldable
          ? <button className="msg-summary" onClick={() => setOpen(v => !v)}>
              <span className="aux-chevron">{open ? '▾' : '▸'}</span>
              <span>{summary}</span>
            </button>
          : <span className="msg-summary">{summary}</span>)}
        <span className="msg-header-right">
          <TokenStats point={point} />
          {end != null && (
            <span className="msg-time" title={duration > 0 ? `Response time: ${fmtDuration(duration)}` : null}>
              {format(end, 'HH:mm:ss')}
            </span>
          )}
        </span>
      </div>
      {(anyVisible || everOpen) && (
        <div className={`assistant-card-body${anyVisible ? '' : ' turn-hidden'}`}>
          {turns.map(t => <TurnRow key={t.uuid} turn={t} hidden={hidden(t)} />)}
        </div>
      )}
    </div>
  )
}

function TurnRow({ turn, hidden = false }) {
  const contextBlocks = [], otherBlocks = []
  const groupAttachments = turn.role === 'user'
  for (const b of turn.blocks) {
    if (b.type === 'attachment' && groupAttachments) contextBlocks.push(b); else otherBlocks.push(b);
  }
  const hasError = turn.blocks.some(b => b.type === 'tool_use' && b.result?.is_error)
  return (
    <div className={`turn turn-${turn.role} ${turn.isMeta ? 'turn-meta-note' : ''} ${hasError ? 'turn-error' : ''} ${hidden ? 'turn-hidden' : ''}`}>
      <div className="turn-blocks">
        {contextBlocks.length > 0 && (
          <Collapsible className="attachment" defaultOpen={false} title={`attachments · ${contextBlocks.length} item${contextBlocks.length === 1 ? '' : 's'}`}>
            {contextBlocks.map((b, i) => <Attachment key={i} att={b.attachment} />)}
          </Collapsible>
        )}
        {otherBlocks.map((b, i) => <Block key={i} block={b} />)}
      </div>
    </div>
  )
}

function Block({ block }) {
  if (block.type === 'text') {
    const cmd = parseCommand(block.text)
    if (cmd) {
      // A tag matched but its body was blank (e.g. a slash command with no stdout) — nothing to show.
      if (!cmd.name && !cmd.args && !cmd.stdout && !cmd.caveat) return null
      return (
        <div className="block-command">
          {cmd.name && <span className="cmd-name">{cmd.name}</span>}
          {cmd.args && <span className="cmd-args"> {cmd.args}</span>}
          {cmd.stdout && <div className="cmd-stdout">{cmd.stdout}</div>}
          {cmd.caveat && <div className="cmd-stdout">{cmd.caveat}</div>}
        </div>
      )
    }
    return <Markdown className="block-text" text={block.text} autoFence />
  }
  if (block.type === 'thinking') {
    if (!block.thinking) return <Label title="Thinking" />
    return <Collapsible title="thinking" defaultOpen={false}><pre>{block.thinking}</pre></Collapsible>
  }
  if (block.type === 'tool_use') {
    return (
      <Collapsible title={toolSummary(block.name, block.input)} defaultOpen={false}>
        <JsonBlock value={block.input} />
        {block.result && <Block block={block.result} />}
      </Collapsible>
    )
  }
  if (block.type === 'tool_result') {
    const c = block.content
    const parts = Array.isArray(c) ? c : [typeof c === 'string' ? { type: 'text', text: c } : c]
    return (
      <div className={`tool-result ${block.is_error ? 'error' : ''}`}>
        <div className="tool-result-label">{block.is_error ? 'Error:' : 'Result:'}</div>
        {parts.map((p, i) => p.type === 'text'
          ? <pre key={i}>{p.text}</pre>
          : <Block key={i} block={p} />)}
      </div>
    )
  }
  if (block.type === 'attachment') {
    return <Attachment att={block.attachment} />
  }
  if (block.type === 'image') {
    const src = block.source
    if (src && src.type === 'base64') {
      return <img className="block-image" src={`data:${src.media_type};base64,${src.data}`} alt="" />
    }
    return <div className="block-aux">[image]</div>
  }
  return <Collapsible title={block.type || 'block'}><pre>{safeJson(block)}</pre></Collapsible>
}

const ATTACHMENT_RENDERERS = {
  selected_lines_in_ide: (a) => {
    const path = a.displayPath || a.filename || ''
    const range = a.lineStart === a.lineEnd ? `L${a.lineStart}` : `L${a.lineStart}-${a.lineEnd}`
    return { title: `Selection in ${a.ideName || 'IDE'} · ${path}:${range}`, body: a.content || '' }
  },
  opened_file_in_ide: (a) => ({ title: `Opened in IDE · ${a.displayPath || a.filename || ''}`, body: null }),
  file: (a) => {
    const f = a.content?.file
    return { title: `File · ${a.displayPath || f?.filePath || a.filename || ''}`, body: f?.content ?? safeJson(a.content) }
  },
  skill_listing: (a) => ({ title: `${a.skillCount} skills`, body: a.content || '', defaultOpen: false }),
  deferred_tools_delta: (a) => ({
    title: `${a.addedNames?.length || 0} deferred tools ${a.removedNames?.length ? `(removed: ${a.removedNames.length})` : ''}`,
    body: safeJson({ added: a.addedNames, removed: a.removedNames }),
    defaultOpen: false,
  }),
}

function Attachment({ att }) {
  const render = ATTACHMENT_RENDERERS[att?.type]
  const { title, body, defaultOpen = false } = render ? render(att) : { title: `Attachment · ${att?.type || 'unknown'}`, body: safeJson(att) }
  if (body == null) return <Label title={title} className="attachment" />
  return (
    <Collapsible title={title} className="attachment" defaultOpen={defaultOpen}>
      <pre>{body}</pre>
    </Collapsible>
  )
}

function Label({ title, className }) {
  return (
    <div className={`aux ${className || ''}`}>
      <span className="aux-label"><span className="aux-chevron">•</span><span>{title}</span></span>
    </div>
  )
}

function Collapsible({ title, children, className, defaultOpen = true }) {
  const [open, setOpen] = useCollapsed(defaultOpen)
  return (
    <div className={`aux ${className || ''}`}>
      <button className="aux-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="aux-chevron">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
      </button>
      {open && <div className="aux-body">{children}</div>}
    </div>
  )
}

function safeJson(x) {
  try { return JSON.stringify(x, null, 2)
   } catch { return String(x)
   }
}

function JsonBlock({ value }) {
  return <Markdown className="block-text" text={'```json\n' + safeJson(value) + '\n```'} />
}

function InstructionFile({ it, showNote }) {
  const [open, setOpen] = useCollapsed(false)
  return (
    <div className="aux instruction-file">
      {showNote && (
        <div className="instructions-note">Extracted from the API requests captured by the proxy.</div>
      )}
      <button className="aux-toggle" onClick={() => setOpen(v => !v)}>
        <span className="aux-chevron">{open ? '▾' : '▸'}</span>
        <span>{`${it.file_path} (${it.memory_type}, API request)`}</span>
      </button>
      {open && (
        <div className="aux-body">
          <Markdown className="block-text" text={it.content || ''} basePath={it.file_path} />
        </div>
      )}
    </div>
  )
}
