import React, { useContext, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Globe, LaptopMinimal, Terminal } from 'lucide-react'
import { fmtCompact, fmtDuration } from '../../utils/formatting'
import { flatten, groupTurns, cycleDurations, tokenPoints, isContextTurn, currentModel, contextWindow, countTokens } from './transcript.js'
import { toolSummary, parseCommand, groupInstructions, instructionTitle, compactTitle, persistedOutput, humanize } from './labels.js'
import Divider from '../../ui/Divider.jsx'
import LazyMount from '../../ui/LazyMount.jsx'
import Markdown from '../../ui/Markdown.jsx'
import OpenLink from '../../ui/OpenLink.jsx'
import { useFindActive } from '../../ui/useFindActive.js'
import { useMouseFontScale } from '../../utils/useMouse.js'
import './ConversationView.css'
import claudeIcon from '../../assets/claude-icon.svg'

// Global expand/collapse signal: null = leave each collapsible on its own state,
// true/false = force open/closed. Changing it re-applies to every collapsible.
const ExpandAllContext = React.createContext(null)
// The top-level transcript's path — saved tool outputs resolve against it (see persistedOutput)
const TranscriptFileContext = React.createContext(null)

function useCollapsed(defaultOpen) {
  const [open, setOpen] = useState(defaultOpen)
  const expandAll       = useContext(ExpandAllContext)
  useEffect(() => { if (expandAll != null) setOpen(expandAll) }, [expandAll])
  return [open, setOpen]
}

// Slash-command invocation (`<command-name>…`): meta for most purposes, but still a user action.
const isCommandTurn = t => t.blocks.some(b => b.type === 'text' && parseCommand(b.text)?.name)
const isClearTurn   = t => t.blocks.some(b => b.type === 'text' && parseCommand(b.text)?.name === '/clear')


export default function ConversationView({ items, instructions = [], filePath = null, expandAll = null, continuesFrom = null, continuesTo = null, onShowPeriodOf }) {
  const turns            = useMemo(() => flatten(items, instructions), [items, instructions])
  const groups           = useMemo(() => groupTurns(turns), [turns])
  const points           = useMemo(() => tokenPoints(groups), [groups])
  const durations        = useMemo(() => cycleDurations(groups), [groups])
  const findOpen         = useFindActive()
  const [scale, zoomRef] = useMouseFontScale('font-scale.conversation')

  const model = currentModel(turns)
  const ctxLimit = contextWindow([model]) // bar scale: fraction of this model's context window
  const hasTimeline = points.some(Boolean)
  const branch = branchPoint(items, groups)
  const branchDivider = branch && <Divider className="conv-divider" title={branch.from}>Branched from session {branch.from.slice(0, 8)}</Divider>
  return (
    <ExpandAllContext.Provider value={expandAll}>
    <TranscriptFileContext.Provider value={filePath}>
      <div ref={zoomRef} className={`conversation${hasTimeline ? ' has-token-timeline' : ''}`} style={{ '--font-scale': scale }}>
        {continuesFrom != null && (
          <Divider className="conv-continues-from" onClick={() => onShowPeriodOf(continuesFrom)} title="Show the earlier period">
            Continues from {format(continuesFrom, 'MMM d, yyyy HH:mm')}
          </Divider>
        )}
        {groups.map((g, i) => (
          <React.Fragment key={g.turns[0].uuid}>
            {i === branch?.index && branchDivider}
            <div className={`conv-row conv-row-${g.kind}`}>
              <LazyMount eager={i < 8} forceMount={findOpen} placeholderMinHeight={80}>
                {g.kind === 'user' || g.kind === 'system' ? <InputRow kind={g.kind} turns={g.turns} point={points[i]} ctxLimit={ctxLimit} />
                 : g.kind === 'assistant' ? <AssistantCard turns={g.turns} point={points[i]} ctxLimit={ctxLimit} duration={durations[i]} showAuthor={groups[i - 1]?.kind !== 'assistant'} />
                 : g.kind === 'compact'   ? <Compaction block={g.turns[0].blocks[0]} />
                 :                        <InstructionRun turns={g.turns} model={model} />}
              </LazyMount>
              {points[i] ? <TokenPoint point={points[i]} />
               // Commands consume no tokens so they never get a real point — mark them with a plain dot.
               : hasTimeline && g.kind === 'user' && g.turns.some(isCommandTurn) && <TokenPoint point={{ role: 'command', delta: 0 }} />}
            </div>
            {g.kind === 'user' && g.turns.some(isClearTurn) && <Divider className="conv-divider">Context cleared</Divider>}
          </React.Fragment>
        ))}
        {branch?.index === groups.length && branchDivider}
        {continuesTo != null && (
          <Divider className="conv-continues-to" onClick={() => onShowPeriodOf(continuesTo)} title="Show the later period">
            Continues on {format(continuesTo, 'MMM d, yyyy HH:mm')}
          </Divider>
        )}
      </div>
    </TranscriptFileContext.Provider>
    </ExpandAllContext.Provider>
  )
}

// A branch (/branch, --fork-session) opens with the source's records copied over, each stamped `forkedFrom` —
// returns the source session and the index of the first group after them (groups.length when none yet).
function branchPoint(items, groups) {
  const from = items.find(it => it.forkedFrom)?.forkedFrom.sessionId
  const first = from && items.find(it => it.timestamp && !it.forkedFrom)
  if (!first) return null
  const ts = Date.parse(first.timestamp)
  const i = groups.findIndex(g => g.turns.some(t => t.ts >= ts))
  return { from, index: i === -1 ? groups.length : i }
}

// From here on the history was replaced by a summary — folded under the divider.
function Compaction({ block }) {
  return (
    <>
      <Divider className="conv-divider">{compactTitle(block)}</Divider>
      {block.summary && <Collapsible title="Summary" defaultOpen={false}><Markdown className="block-text" text={block.summary} autoFence /></Collapsible>}
    </>
  )
}

// Anthropic's official Claude sunburst mark, in the brand's clay-orange.
const ClaudeIcon = () => <img className="msg-icon claude-icon" src={claudeIcon} alt="" />

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

// Total-tokens figure, shared by user and assistant headers. Its tooltip (HTML, opt-in via
// data-tippy-html — see main.jsx) carries the context bar, the turn's usage breakdown
// (labels/formulas mirror SessionSummary's Tokens section) and the running total. All values
// are numeric/trusted; never interpolate transcript text into this string.
function TokenStats({ point, ctxLimit }) {
  if (!point) return null
  const rows = []
  if (point.ctx != null) {
    const width = Math.min(point.ctx / ctxLimit, 1) * 100
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
    <span className="msg-tokens" data-tippy-html={`<div class="token-tooltip">${rows.join('')}</div>`}>
      {fmtCompact(point.total)}
    </span>
  )
}

const AUTHORS = {
  user:   { Icon: Terminal, name: 'You' },
  system: { Icon: LaptopMinimal, name: 'System' },
}

// A You or System row: its messages, with the context that came along folded behind the header
function InputRow({ kind, turns, point, ctxLimit }) {
  const [open, setOpen] = useCollapsed(false)
  const msgs            = turns.filter(t => !isContextTurn(t))
  const ctxItems        = turns.filter(isContextTurn).flatMap(t => t.blocks)
  const ts              = (msgs[0] ?? turns[0]).ts
  const { Icon, name }  = AUTHORS[kind]
  return (
    <div className={`msg-${kind}`}>
      <div className="msg-header">
        <Icon className="msg-icon" />
        <span className="msg-author">{name}</span>
        {msgs.some(t => t.queued) && <span className="msg-summary">queued during the previous turn</span>}
        {ctxItems.length > 0 && (
          <button className="msg-summary" onClick={() => setOpen(v => !v)}>
            <span className="aux-chevron">{open ? '▾' : '▸'}</span>
            <span>{ctxItems.length} attachment{ctxItems.length === 1 ? '' : 's'}</span>
          </button>
        )}
        <span className="msg-header-right">
          <TokenStats point={point} ctxLimit={ctxLimit} />
          {ts != null && <span className="msg-time">{format(ts, 'HH:mm:ss')}</span>}
        </span>
      </div>
      {open && ctxItems.length > 0 && (
        <div className="msg-context">
          {ctxItems.map((b, i) => <Attachment key={i} att={b.attachment} />)}
        </div>
      )}
      {msgs.map(t => <TurnRow key={t.uuid} turn={t} />)}
    </div>
  )
}

function AssistantCard({ turns, point, ctxLimit, duration, showAuthor = true }) {
  const [open, setOpen] = useCollapsed(false)
  const toolBlocks = turns.flatMap(t => t.blocks.filter(b => b.type === 'tool_use'))
  const errorCount = toolBlocks.filter(b => b.result?.is_error).length
  const skillCount = toolBlocks.filter(b => b.name === 'Skill').length
  const isAux      = t => t.role === 'system' ? !t.blocks.some(b => b.level) : !t.blocks.some(b => b.type === 'text')
  // Aux turns (tool calls, thinking, System's injections — not its warning/error notes) fold behind the chevron, but only if there are tool calls
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
    skillCount > 0 && `${skillCount} skill${skillCount === 1 ? '' : 's'}`,
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
          <TokenStats point={point} ctxLimit={ctxLimit} />
          {end != null && (
            <span className="msg-time" title={duration > 0 ? `Response time: ${fmtDuration(duration)}` : null}>
              {format(end, 'HH:mm:ss')}
            </span>
          )}
        </span>
      </div>
      {(anyVisible || everOpen) && (
        <div className={`assistant-card-body${anyVisible ? '' : ' turn-hidden'}`}>
          {/* Mid-cycle, no System header names its injections — prefix them, telling them apart from Claude's tool calls */}
          {turns.map(t => <TurnRow key={t.uuid} turn={t} hidden={hidden(t)} speaker={t.role === 'system' ? 'System' : null} />)}
        </div>
      )}
    </div>
  )
}

function TurnRow({ turn, hidden = false, speaker = null }) {
  const contextBlocks = [], otherBlocks = []
  const groupAttachments = turn.role === 'user'
  for (const b of turn.blocks) {
    if (b.type === 'attachment' && groupAttachments) contextBlocks.push(b); else otherBlocks.push(b);
  }
  const hasError = turn.blocks.some(b => b.type === 'tool_use' && b.result?.is_error)
  return (
    <div className={`turn turn-${turn.role} ${hasError ? 'turn-error' : ''} ${hidden ? 'turn-hidden' : ''}`}>
      <div className="turn-blocks">
        {contextBlocks.length > 0 && (
          <Collapsible className="attachment" defaultOpen={false} title={`${contextBlocks.length} attachment${contextBlocks.length === 1 ? '' : 's'}`}>
            {contextBlocks.map((b, i) => <Attachment key={i} att={b.attachment} />)}
          </Collapsible>
        )}
        {otherBlocks.map((b, i) => <Block key={i} block={b} speaker={speaker} />)}
      </div>
    </div>
  )
}

// `speaker` prefixes the titles of top-level notes and attachments
function Block({ block, speaker = null }) {
  if (block.type === 'text') {
    const cmd = parseCommand(block.text)
    if (cmd) {
      // A tag matched but its body was blank (e.g. a slash command with no stdout) — nothing to show.
      if (!cmd.name && !cmd.args && !cmd.stdout && !cmd.caveat) return null
      // Multi-line args are a prompt the user wrote (e.g. a skill's brief) — render them like one.
      const promptArgs = cmd.args.trim().includes('\n')
      return (
        <>
          <div className="block-command">
            {cmd.name && <span className="cmd-name">{cmd.name}</span>}
            {cmd.args && !promptArgs && <span className="cmd-args"> {cmd.args}</span>}
            {cmd.stdout && <div className="cmd-stdout">{cmd.stdout}</div>}
            {cmd.caveat && <div className="cmd-stdout">{cmd.caveat}</div>}
          </div>
          {promptArgs && <Markdown className="block-text" text={cmd.args} autoFence />}
        </>
      )
    }
    return <Markdown className="block-text" text={block.text} autoFence />
  }
  if (block.type === 'thinking') {
    if (block.redacted) return <Label title={`Thinking (encrypted${block.redacted > 1 ? ` · ${block.redacted}` : ''})`} />
    return <Collapsible title="Thinking" defaultOpen={false}><pre>{block.thinking}</pre></Collapsible>
  }
  if (block.type === 'tool_use') {
    return (
      <Collapsible title={toolSummary(block.name, block.input)} defaultOpen={false}>
        <JsonBlock value={block.input} />
        {block.result && <Block block={block.result} />}
      </Collapsible>
    )
  }
  if (block.type === 'skill') {
    return <Collapsible title={block.name ? `Skill: ${block.name}` : 'Skill'} defaultOpen={false}><Markdown className="block-text" text={block.text} /></Collapsible>
  }
  if (block.type === 'tool_result') {
    const c = block.content
    const parts = Array.isArray(c) ? c : [typeof c === 'string' ? { type: 'text', text: c } : c]
    return (
      <div className={`tool-result ${block.is_error ? 'error' : ''}`}>
        <div className="tool-result-label">{block.is_error ? 'Error:' : 'Result:'}</div>
        {parts.map((p, i) => p.type === 'text'
          ? <React.Fragment key={i}><SavedOutputLink text={p.text} /><pre>{p.text}</pre></React.Fragment>
          : <Block key={i} block={p} />)}
      </div>
    )
  }
  if (block.type === 'attachment') {
    return <Attachment att={block.attachment} speaker={speaker} />
  }
  if (block.type === 'system') {
    const className = `system-note ${block.level ?? ''} ${block.kind ?? ''}`
    if (!block.body) return <Label title={said(speaker, block.url ? <OpenLink href={block.url}>{block.title}</OpenLink> : block.title)} className={className} />
    return <Collapsible title={said(speaker, block.title)} className={className} defaultOpen={!!block.level}><pre>{block.body}</pre></Collapsible>
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

function SavedOutputLink({ text }) {
  const baseFile = useContext(TranscriptFileContext)
  const saved    = persistedOutput(text)
  if (!saved || !baseFile) return null
  return <div className="tool-result-label saved-output">Full output: <OpenLink href={saved.href} basePath={baseFile}>{saved.path}</OpenLink></div>
}

const ATTACHMENT_RENDERERS = {
  selected_lines_in_ide: (a) => {
    const path = a.displayPath || a.filename || ''
    const range = a.lineStart === a.lineEnd ? `L${a.lineStart}` : `L${a.lineStart}-${a.lineEnd}`
    return { title: `Selection in ${a.ideName || 'IDE'}: ${path}:${range}`, body: a.content || '' }
  },
  opened_file_in_ide: (a) => ({ title: `Opened in IDE: ${a.displayPath || a.filename || ''}`, body: null }),
  file: (a) => {
    const f = a.content?.file
    return { title: `File: ${a.displayPath || f?.filePath || a.filename || ''}`, body: f?.content ?? safeJson(a.content) }
  },
  skill_listing: (a) => ({ title: `${a.skillCount} skills`, body: a.content || '', defaultOpen: false }),
  deferred_tools_delta: (a) => ({
    title: `${a.addedNames?.length || 0} deferred tools ${a.removedNames?.length ? `(removed: ${a.removedNames.length})` : ''}`,
    body: safeJson({ added: a.addedNames, removed: a.removedNames }),
    defaultOpen: false,
  }),
  prompt_snapshot: a => ({
    title: `Prompt snapshot: system prompt, ${a.tools?.length ?? 0} tools`,
    body: [...(a.systemPrompt ?? []), `Tools: ${(a.tools ?? []).map(t => t.name).join(', ')}`].join('\n\n'),
  }),
  // The one nested shape the fallback below can't flatten: files → diagnostics → range.
  diagnostics: (a) => {
    const lines = (a.files || []).flatMap(f => (f.diagnostics || [])
      .map(d => `${f.uri}:${(d.range?.start?.line ?? 0) + 1} ${d.severity}: ${d.message}${d.source ? ` (${d.source})` : ''}`))
    return { title: `Diagnostics: ${lines.length} in ${a.files?.length || 0} file${a.files?.length === 1 ? '' : 's'}`, body: lines.join('\n') }
  },
  // addedLines carry each agent's one-line description; addedTypes is just their names.
  agent_listing_delta: (a) => ({
    title: `${a.addedTypes?.length || 0} agent types${a.removedTypes?.length ? ` (removed: ${a.removedTypes.length})` : ''}`,
    body: (a.addedLines || a.addedTypes || []).join('\n'),
    defaultOpen: false,
  }),
}

// Everything else — Claude Code keeps adding attachment types (hooks, plan mode, tips, …), so the
// fallback reads them structurally instead of growing a renderer per type: the first short string
// names the thing (a path, a hook, a date), long ones are the content, and if several short strings
// carry the payload nothing is hidden — the raw record stays as the body.
function genericAttachment(att) {
  const short = [], long = []
  const collect = (v, key) => {
    if (typeof v === 'string') { if (v.trim()) (v.length > 100 ? long : short).push([key, v]) }
    else if (Array.isArray(v)) { for (const x of v) collect(x, key) }
    else if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) collect(x, k) }
  }
  for (const [k, v] of Object.entries(att || {})) { if (k !== 'type') collect(v, k) }
  const detail = short.find(([k]) => /path|file|name|dir|uri|url|date/i.test(k))?.[1] // what the attachment is about
  const label = humanize(att?.type || 'attachment')
  return {
    title: detail ? `${label}: ${detail}` : label,
    body: long.length ? long.map(([, v]) => v).join('\n\n') : short.length > 1 ? safeJson(att) : null,
  }
}

function Attachment({ att, speaker = null }) {
  const render = ATTACHMENT_RENDERERS[att?.type]
  const { title, body, defaultOpen = false } = render ? render(att) : genericAttachment(att)
  if (body == null) return <Label title={said(speaker, title)} className="attachment" />
  return (
    <Collapsible title={said(speaker, title)} className="attachment" defaultOpen={defaultOpen}>
      <pre>{body}</pre>
    </Collapsible>
  )
}

const said = (speaker, title) => speaker ? <><span className="aux-speaker">{speaker}: </span>{title}</> : title

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

// The session's instruction files, grouped by the part of the request they were read from
// (system prompt / tools / user message), with a summed token total under them once there's
// more than one file to add up.
function InstructionRun({ turns, model }) {
  const strips = turns.flatMap(t => t.blocks).map(({ it }) => ({ ...it, tokens: countTokens(it.content, it.model ?? model) }))
  return (
    <>
      <div className="msg-header msg-proxy">
        <Globe className="msg-icon" />
        <span className="msg-author">Proxy</span>
      </div>
      {groupInstructions(strips).map(([label, list]) => (
        <React.Fragment key={label}>
          <div className="aux instruction-source">{label}</div>
          {list.map(it => <InstructionFile key={`${it.hash ?? it.file_path}-${it.timestamp}`} it={it} model={model} tokens={it.tokens} />)}
        </React.Fragment>
      ))}
      {strips.length > 1 && (
        <div className="aux instruction-total"><span className="instruction-tokens">~ {fmtCompact(strips.reduce((a, it) => a + it.tokens, 0))}</span></div>
      )}
    </>
  )
}

function InstructionFile({ it, model, tokens }) {
  const [open, setOpen] = useCollapsed(false)
  return (
    <div className="aux instruction-file">
      <button className="aux-toggle" onClick={() => setOpen(v => !v)}>
        <span className="aux-chevron">{open ? '▾' : '▸'}</span>
        <span>{instructionTitle(it, model)}</span>
        {tokens > 0 && <span className="instruction-tokens" title="Approx. tokens">~ {fmtCompact(tokens)}</span>}
      </button>
      {open && (
        <div className="aux-body">
          {it.name && it.name !== it.file_path && <div className="instruction-path">{it.file_path}</div>}
          {it.tools
            ? it.tools.map(t => <InstructionFile key={t.name} it={{ file_path: t.name, content: t.content }} model={model} tokens={countTokens(t.content, it.model ?? model)} />)
            : <Markdown className="block-text" text={it.content || ''} basePath={it.file_path} />}
        </div>
      )}
    </div>
  )
}
