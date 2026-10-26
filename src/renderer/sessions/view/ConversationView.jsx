import React, { useContext, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Globe, LaptopMinimal, Terminal } from 'lucide-react'
import { fmtCompact, fmtDuration, plural, tone } from '../../utils/formatting'
import { THRESHOLDS as T } from '../../utils/thresholds.js'
import { flatten, groupTurns, cycleDurations, tokenPoints, branchPoint, currentModel, contextWindow, countTokens } from './transcript.js'
import { toolSummary, parseCommand, isClearTurn, instructionTitle, compactTitle, persistedOutput, attachmentView, hasText, safeJson, SIDE_NOTE } from './labels.js'
import Divider from '../../ui/Divider.jsx'
import LazyMount from '../../ui/LazyMount.jsx'
import Markdown from '../../ui/Markdown.jsx'
import OpenLink from '../../ui/OpenLink.jsx'
import ProgressBar from '../../ui/ProgressBar.jsx'
import Tip from '../../ui/Tip.jsx'
import { useFindActive } from '../../ui/useFindActive.js'
import { useMouseFontScale } from '../../utils/useMouse.js'
import { useActivity } from '../../utils/activity.js'
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

export const FILTERS = [
  { value: 'user', label: 'User messages' },
  { value: 'assistant', label: 'Claude messages' },
  { value: 'system', label: 'System & memory files' },
  { value: 'other', label: 'Everything else' },
]
const CATEGORY = { compact: 'system', instruction: 'other' }

// System's turns count as `system` even mid-cycle inside a Claude card; a card left with only those shows as System's row
function filtered(g, filter) {
  if (!filter.length) return g
  const turns = g.turns.filter(t => filter.includes(CATEGORY[g.kind] ?? (t.role === 'system' ? 'system' : g.kind)))
  if (!turns.length) return null
  return { kind: turns.every(t => t.role === 'system') ? 'system' : g.kind, turns }
}

export default function ConversationView({ items, instructions = {}, filePath = null, expandAll = null, filter = [], continuesFrom = null, continuesTo = null, forkedFrom = null, forkedAt = null, onShowPeriodOf }) {
  const turns            = useMemo(() => flatten(items, instructions), [items, instructions])
  const groups           = useMemo(() => groupTurns(turns), [turns])
  const points           = useMemo(() => tokenPoints(groups), [groups])
  const durations        = useMemo(() => cycleDurations(groups), [groups])
  const findOpen         = useFindActive()
  const [scale, zoomRef] = useMouseFontScale('font-scale.conversation')

  const model = currentModel(turns)
  const ctxLimit = contextWindow([model]) // bar scale: fraction of this model's context window
  const hasTimeline = points.some(Boolean)
  const shown = groups.map(g => filtered(g, filter))
  const branch = branchPoint(groups, forkedFrom, forkedAt, continuesFrom)
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
        {shown.map((g, i) => (
          <React.Fragment key={groups[i].turns[0].uuid}>
            {i === branch?.index && branchDivider}
            {g && <div className={`conv-row conv-row-${g.kind}`}>
              <LazyMount eager={i < 8} forceMount={findOpen} placeholderMinHeight={80}>
                {g.kind === 'user' || g.kind === 'system' ? <InputRow kind={g.kind} turns={g.turns} point={points[i]} index={i} />
                 : g.kind === 'assistant' ? <AssistantCard turns={g.turns} point={points[i]} index={i} duration={durations[i]} ctxLimit={ctxLimit} showAuthor={groups[i - 1]?.kind !== 'assistant'} />
                 : g.kind === 'compact'   ? <Compaction block={g.turns[0].blocks[0]} />
                 :                        <InstructionRun turns={g.turns} model={model} />}
              </LazyMount>
              {hasTimeline && <TokenPoint at={Math.max(...groups[i].turns.map(t => t.ts ?? 0))} />}
            </div>}
            {groups[i].kind === 'user' && groups[i].turns.some(isClearTurn) && <Divider className="conv-divider">Context cleared</Divider>}
          </React.Fragment>
        ))}
        {filter.length > 0 && !shown.some(Boolean) && <div className="empty">Nothing in this session matches the filter.</div>}
        {branch?.index === groups.length && branchDivider}
        {continuesTo != null && (
          <Divider className="conv-continues-to" onClick={() => onShowPeriodOf(continuesTo)} title="Show the later period">
            Continues on {format(continuesTo, 'MMM d, yyyy HH:mm')}
          </Divider>
        )}
        <Tip anchorSelect=".msg-tokens" render={({ activeAnchor }) => {
          const point = points[activeAnchor?.dataset.point] // the last-hovered anchor outlives its group when the transcript regroups
          return point && <TokenTip point={point} />
        }} />
      </div>
    </TranscriptFileContext.Provider>
    </ExpandAllContext.Provider>
  )
}

// From here on the history was replaced by a summary — open under the divider, unlike other aux blocks, since it is all the model still knows of it.
function Compaction({ block }) {
  return (
    <>
      <Divider className="conv-divider">{compactTitle(block)}</Divider>
      {block.summary && <Collapsible title="Compact summary" tokens={countTokens(block.summary)}><Markdown className="block-text" text={block.summary} autoFence /></Collapsible>}
    </>
  )
}

// Anthropic's official Claude sunburst mark, in the brand's clay-orange.
const ClaudeIcon = () => <img className="msg-icon claude-icon" src={claudeIcon} alt="" />

// Sits in the conversation's right gutter at the row's own position, so it scrolls with
// the content — no scroll syncing or measurement needed. Just a dot; the numbers it used
// to show in a tooltip now live in the assistant card header instead.
function TokenPoint({ at }) {
  return (
    <div className={`token-point ${useActivity(at)}`}>
      <span className="token-point-dot" />
    </div>
  )
}

// Total-tokens figure in user and assistant headers; indexes into the one shared TokenTip, as a tooltip per message would slow long conversations
function TokenStats({ point, index }) {
  if (!point) return null
  return <span className="msg-tokens" data-point={index}>{fmtCompact(point.total)}</span>
}

// The context size of the cycle's last API call, as a fill bar of the model's window plus the figure
function ContextStat({ point, ctxLimit }) {
  if (point?.ctx == null) return null
  const pct = point.ctx / ctxLimit * 100
  return (
    <span className="msg-ctx" data-tooltip-content={`Context: ${fmtCompact(point.ctx)} / ${fmtCompact(ctxLimit)} (${Math.round(pct)}%)`}>
      <ProgressBar pct={pct} tone={tone(point.ctx, T.context)} /> {fmtCompact(point.ctx)}
    </span>
  )
}

const USAGE_ROWS = [['Input', 'input'], ['Output', 'output'], ['Cache write (5m)', 'cacheCreation5m'], ['Cache write (1h)', 'cacheCreation1h'], ['Cache read', 'cacheRead']]

// The context size, the turn's usage breakdown (labels/formulas mirror SessionSummary's Tokens section) and the running total
function TokenTip({ point }) {
  const u = point.usage
  return (
    <div className="token-tooltip">
      {point.ctx != null && (
        <div className="token-tooltip-ctx">
          Context <span className="token-tooltip-ctx-val">{fmtCompact(point.ctx)}</span>
        </div>
      )}
      {u && (
        <div className="token-tooltip-grid">
          {USAGE_ROWS.map(([label, key]) => <React.Fragment key={key}><span>{label}</span><span>{fmtCompact(u[key])}</span></React.Fragment>)}
          {/* Turn total: unlabeled sum row, its top border draws the "adding-up" line over the values column */}
          <span /><span className="token-tooltip-sum">+{fmtCompact(u.input + u.output + u.cacheRead + u.cacheCreation)}</span>
        </div>
      )}
      <div className="token-tooltip-total"><span>Accumulated tokens</span><span>{fmtCompact(point.total)}</span></div>
    </div>
  )
}

const AUTHORS = {
  user:   { Icon: Terminal, name: 'You' },
  system: { Icon: LaptopMinimal, name: 'System' },
}

// Context and the CLI's routine notices — what the transcript model marks `folded`
const isFolded = t => t.blocks.every(b => b.folded)

// Attachments that carry a token count (@-files, skill and agent listings) list above the message; only the uncounted rest fold
const isCounted = b => b.type === 'attachment' && !b.unsent && hasText(attachmentView(b.attachment, b.rendered))

// A You or System row: its messages, with the context that came along folded behind the header
function InputRow({ kind, turns, point, index }) {
  const [open, setOpen] = useCollapsed(false)
  const msgs            = turns.filter(t => !isFolded(t))
  const folded          = turns.filter(isFolded).flatMap(t => t.blocks)
  const counted         = new Set(folded.filter(isCounted))
  const ctxItems        = folded.filter(b => !counted.has(b))
  const ts             = (msgs[0] ?? turns[0]).ts
  const { Icon, name }  = AUTHORS[kind]
  const count           = (type, noun) => { const n = ctxItems.filter(b => b.type === type).length; return n > 0 && plural(n, noun) }
  const summary         = [count('attachment', 'attachment'), count('system', 'notice')].filter(Boolean).join(', ')
  return (
    <div className={`msg-${kind}`}>
      <div className="msg-header">
        <Icon className="msg-icon" />
        <span className="msg-author">{name}</span>
        {msgs.some(t => t.queued) && <span className="msg-summary">queued during the previous turn</span>}
        {ctxItems.length > 0 && (
          <button className="msg-summary" onClick={() => setOpen(v => !v)}>
            <span className="aux-chevron">{open ? '▾' : '▸'}</span>
            <span>{summary}</span>
          </button>
        )}
        <span className="msg-header-right">
          <TokenStats point={point} index={index} />
          {ts != null && <span className="msg-time">{format(ts, 'HH:mm:ss')}</span>}
        </span>
      </div>
      {(open ? folded.length : counted.size) > 0 && (
        <div className="msg-context">
          {folded.map((b, i) => counted.has(b) ? <div key={i} className="listed"><Block block={b} /></div> : open && <Block key={i} block={b} />)}
        </div>
      )}
      {msgs.map(t => <TurnRow key={t.uuid} turn={t} />)}
    </div>
  )
}

function AssistantCard({ turns, point, index, duration, ctxLimit, showAuthor = true }) {
  const [open, setOpen] = useCollapsed(false)
  const toolBlocks = turns.flatMap(t => t.blocks.filter(b => b.type === 'tool_use'))
  const errorCount = toolBlocks.filter(b => b.result?.is_error).length
  const skillCount = toolBlocks.filter(b => b.name === 'Skill').length
  const isAux      = t => t.role === 'system' ? isFolded(t) : !t.blocks.some(b => b.type === 'text')
  // Aux turns (tool calls, thinking, System's bookkeeping) fold behind the chevron, but only if there are tool calls
  const foldable   = toolBlocks.length > 0 && turns.some(isAux)
  const end        = turns.findLast(t => t.ts != null)?.ts ?? null
  // Once opened, keep aux turns mounted while folded (hidden via CSS) so each tool's expanded state
  // survives a fold/unfold. Never-opened cards stay unmounted so we don't eagerly render every tool.
  const [everOpen, setEverOpen] = useState(false)
  useEffect(() => { if (open) setEverOpen(true) }, [open])
  const hidden     = t => !open && foldable && isAux(t)
  const anyVisible = turns.some(t => !hidden(t))
  const parts = [
    toolBlocks.length > 0 && plural(toolBlocks.length, 'tool call'),
    skillCount > 0 && plural(skillCount, 'skill'),
    errorCount > 0 && <span key="err" className="msg-errors">{plural(errorCount, 'error')}</span>,
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
          <ContextStat point={point} ctxLimit={ctxLimit} />
          <TokenStats point={point} index={index} />
          {end != null && (
            <span className="msg-time" data-tooltip-content={duration > 0 ? `Response time: ${fmtDuration(duration)}` : null}>
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
          <Collapsible className="attachment" defaultOpen={false} title={plural(contextBlocks.length, 'attachment')}>
            {contextBlocks.map((b, i) => <Attachment key={i} att={b.attachment} rendered={b.rendered} folded={b.folded} unsent={b.unsent} />)}
          </Collapsible>
        )}
        {otherBlocks.map((b, i) => <Block key={i} block={b} speaker={speaker} ts={turn.ts} />)}
      </div>
    </div>
  )
}

// `speaker` prefixes the titles of top-level notes and attachments
function Block({ block, speaker = null, ts = null }) {
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
    return <Collapsible title="Thinking" defaultOpen={false} time={ts} duration={block.duration}><pre>{block.thinking}</pre></Collapsible>
  }
  if (block.type === 'tool_use') {
    return (
      <Collapsible title={toolSummary(block.name, block.input)} defaultOpen={false} time={ts} duration={block.duration}>
        <JsonBlock value={block.input} />
        {block.result && <Block block={block.result} />}
      </Collapsible>
    )
  }
  if (block.type === 'skill') {
    return <Collapsible title={block.name ? `Skill: ${block.name}` : 'Skill'} className="listed" defaultOpen={false} tokens={countTokens(block.text)}><Markdown className="block-text" text={block.text} /></Collapsible>
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
    return <Attachment att={block.attachment} rendered={block.rendered} folded={block.folded} unsent={block.unsent} speaker={speaker} />
  }
  if (block.type === 'instruction') {
    return <InstructionFile it={block.it} model={block.it.model} tokens={countTokens(block.it.content, block.it.model)} speaker={speaker} className="directive" />
  }
  if (block.type === 'system') {
    const className = `system-note ${block.level ?? ''} ${block.kind ?? ''}`
    if (!block.body) return <Label title={said(speaker, block.url ? <OpenLink href={block.url}>{block.title}</OpenLink> : block.title)} className={className} />
    return <Collapsible title={said(speaker, block.title)} className={className} defaultOpen={!block.folded}><pre>{block.body}</pre></Collapsible>
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

// An attachment the model didn't fold is a directive to Claude: open, and tinted apart
function Attachment({ att, rendered, folded = true, unsent = false, speaker = null }) {
  const view            = attachmentView(att, rendered)
  const { title, body } = view
  const className       = `attachment${folded ? '' : ' directive'}`
  if (body == null) return <Label title={said(speaker, title)} className={className} />
  return (
    <Collapsible title={said(speaker, title)} className={className} defaultOpen={!folded} tokens={!unsent && hasText(view) && countTokens(body)}>
      {view.items?.length ? <ItemFolds {...view} /> : <pre>{body}</pre>}
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

function Collapsible({ title, children, className, defaultOpen = true, tokens, time = null, duration }) {
  const [open, setOpen] = useCollapsed(defaultOpen)
  return (
    <div className={`aux ${className || ''}`}>
      <button className="aux-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="aux-chevron">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        <ApproxTokens tokens={tokens} />
        {duration >= 0 && <span className={`aux-duration${duration < 1000 ? ' instant' : ''}`} data-tooltip-content={format(time, 'HH:mm:ss')}>{fmtElapsed(duration)}</span>}
      </button>
      {open && <div className="aux-body">{children}</div>}
    </div>
  )
}

// Tool calls often finish in milliseconds, which fmtDuration would round to nothing
const fmtElapsed = ms => ms < 1000 ? '<1s' : fmtDuration(ms)

const ApproxTokens = ({ tokens }) => tokens > 0 && <span className="instruction-tokens" data-tooltip-content="Approx. tokens">~ {fmtCompact(tokens)}</span>

function JsonBlock({ value }) {
  return <Markdown className="block-text" text={'```json\n' + safeJson(value) + '\n```'} />
}

// A side request's instruction files, in request order, with a summed token total once there's more than one file
function InstructionRun({ turns, model }) {
  const strips = turns.flatMap(t => t.blocks).map(({ it }) => ({ ...it, tokens: countTokens(it.content, it.model ?? model) }))
  return (
    <>
      <div className="msg-header msg-proxy">
        <Globe className="msg-icon" />
        <span className="msg-author">Proxy</span>
        <span className="msg-summary">{SIDE_NOTE}</span>
        <span className="msg-header-right">
          <span className="msg-time">{format(Date.parse(strips[0].timestamp), 'HH:mm:ss')}</span>
        </span>
      </div>
      {strips.map(it => <InstructionFile key={`${it.hash}-${it.timestamp}`} it={it} model={model} tokens={it.tokens} />)}
      {strips.length > 1 && (
        <div className="aux instruction-total"><ApproxTokens tokens={strips.reduce((a, it) => a + it.tokens, 0)} /></div>
      )}
    </>
  )
}

function InstructionFile({ it, model, tokens, speaker = null, className = '' }) {
  const [open, setOpen] = useCollapsed(false)
  const title           = instructionTitle(it, model)
  return (
    <div className={`aux instruction-file ${className}`}>
      <button className="aux-toggle" onClick={() => setOpen(v => !v)}>
        <span className="aux-chevron">{open ? '▾' : '▸'}</span>
        <span className="instruction-title" data-tooltip-content={title} data-tip-if-truncated>{said(speaker, title)}</span>
        <ApproxTokens tokens={tokens} />
      </button>
      {open && (
        <div className="aux-body">
          {it.name && it.name !== it.file_path && <div className="instruction-path">{it.file_path}</div>}
          {it.items
            ? <ItemFolds {...it} model={it.model ?? model} />
            : <Markdown className="block-text" text={it.content || ''} basePath={it.file_path} />}
        </div>
      )}
    </div>
  )
}

// A strip's or listing's items (tools, skills, agent types, …), each folding on its own, between the text around them
function ItemFolds({ intro, items, outro, model }) {
  return (
    <>
      {intro && <Markdown className="block-text" text={intro} />}
      {items.map(t => <InstructionFile key={t.name} it={{ ...t, file_path: t.name }} model={model} tokens={countTokens(t.content, model)} />)}
      {outro && <Markdown className="block-text" text={outro} />}
    </>
  )
}
