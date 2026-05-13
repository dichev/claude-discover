import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import { fmtCompact } from '../../utils/formatting'
import { fenceBlocks, parseCommand } from '../../utils/textBlock.js'
import LazyMount from '../../ui/LazyMount.jsx'
import './ConversationView.css'

export function flatten(items) {
  const turns = []
  const results = {}
  for (const it of items) {
    if (it.type === 'attachment' && it.attachment) {
      const block = { type: 'attachment', attachment: it.attachment }
      const last = turns[turns.length - 1]
      // Coalesce consecutive harness-injected attachments into one meta turn.
      // Never merge into a real user/assistant turn — that would pull tool_result
      // turns out of their tool-group bucket and render them as user bubbles.
      if (last && last.isMeta && last.blocks.every(b => b.type === 'attachment')) {
        last.blocks.push(block)
        if (it._tokenDelta != null) last.tokenDelta = (last.tokenDelta ?? 0) + it._tokenDelta
        if (it._tokenTotal != null) last.tokenTotal = it._tokenTotal
      } else {
        // Side the meta belongs to: attachments after an assistant turn (between tool cycles)
        // are part of what the assistant just produced/received; otherwise they sit with the user.
        turns.push({
          uuid: it.uuid,
          role: last?.role === 'assistant' ? 'assistant' : 'user',
          isMeta: true,
          ts: it.timestamp ? Date.parse(it.timestamp) : null,
          model: null,
          usage: null,
          tokenDelta: it._tokenDelta ?? null,
          tokenTotal: it._tokenTotal ?? null,
          blocks: [block]
        })
      }
      continue
    }
    if (it.type !== 'user' && it.type !== 'assistant') continue
    const msg = it.message || {}
    const blocks = normalizeContent(msg.content)
    if (blocks.length === 0) continue
    for (const b of blocks) {
      if (b.type === 'tool_result' && b.tool_use_id) results[b.tool_use_id] = b
    }
    turns.push({
      uuid: it.uuid,
      role: it.type,
      isMeta: !!it.isMeta,
      ts: it.timestamp ? Date.parse(it.timestamp) : null,
      model: msg.model || null,
      usage: msg.usage || null,
      tokenDelta: it._tokenDelta ?? null,
      tokenTotal: it._tokenTotal ?? null,
      blocks
    })
  }
  for (const t of turns) {
    t.blocks = t.blocks
      .map((b) => (b.type === 'tool_use' ? { ...b, result: results[b.id] } : b))
      .filter((b) => !(b.type === 'tool_result' && results[b.tool_use_id]))
  }
  return turns.filter((t) => t.blocks.length > 0)
}


function AccumUsage({ usageMeta }) {
  if (!usageMeta?.delta) return null
  const { total, delta } = usageMeta
  const sign = delta >= 0 ? '+' : ''
  return <>
    <span className="meta-delta">{sign}{fmtCompact(delta)} / </span>{fmtCompact(total)}
  </>
}

function normalizeContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.map((b) => (typeof b === 'string' ? { type: 'text', text: b } : b))
}

function groupTurns(turns) {
  const groups = []
  let bucket = null
  for (const t of turns) {
    const hasText = t.blocks.some((b) => b.type === 'text')
    const hasAttachment = t.blocks.some((b) => b.type === 'attachment')
    if (hasText || (t.role === 'user' && hasAttachment)) {
      if (bucket) { groups.push(bucket)
       bucket = null
       }
      groups.push({ kind: 'turn', turn: t })
    } else {
      if (!bucket) bucket = { kind: 'tools', turns: [] }
      bucket.turns.push(t)
    }
  }
  if (bucket) groups.push(bucket)
  return groups
}

export default function ConversationView({ items }) {
  const turns = useMemo(() => flatten(items), [items])
  const groups = useMemo(() => groupTurns(turns), [turns])
  const groupsWithMeta = useMemo(() => {
    return groups.map(g => {
      let delta = null
      let total = null
      const turns = g.kind === 'turn' ? [g.turn] : g.turns
      for (const t of turns) {
        if (t.tokenDelta != null) delta = (delta ?? 0) + t.tokenDelta
        if (t.tokenTotal != null) total = t.tokenTotal
      }
      return { g, usageMeta: total > 0 ? { total, delta } : null }
    })
  }, [groups])
  if (turns.length === 0) {
    return <div className="empty">No user/assistant turns to display.</div>
  }
  return (
    <div className="conversation">
      {groupsWithMeta.map(({ g, usageMeta }, i) => (
        <LazyMount key={g.kind === 'turn' ? g.turn.uuid : `tools-${i}`} eager={i < 8} placeholderMinHeight={80}>
          {g.kind === 'turn'
            ? <TurnRow turn={g.turn} usageMeta={usageMeta} />
            : <ToolGroup turns={g.turns} usageMeta={usageMeta} />}
        </LazyMount>
      ))}
    </div>
  )
}

const CONTEXT_ATTACHMENT_TYPES = new Set(['deferred_tools_delta', 'skill_listing', 'selected_lines_in_ide', 'diagnostics'])

function TurnRow({ turn, usageMeta }) {
  const contextBlocks = [], otherBlocks = []
  for (const b of turn.blocks) {
    const isContextAttachment = b.type === 'attachment' && CONTEXT_ATTACHMENT_TYPES.has(b.attachment?.type)
    if (isContextAttachment) contextBlocks.push(b); else otherBlocks.push(b);
  }
  return (
    <div className={`turn turn-${turn.role} ${turn.isMeta ? 'turn-meta-note' : ''}`}>
      <div className="turn-blocks">
        {contextBlocks.length > 0 && (
          <Collapsible title="context" className="attachment" defaultOpen={false}>
            {contextBlocks.map((b, i) => <Attachment key={i} att={b.attachment} />)}
          </Collapsible>
        )}
        {otherBlocks.map((b, i) => <Block key={i} block={b} />)}
      </div>
      {usageMeta?.delta && <div className="turn-meta"><AccumUsage usageMeta={usageMeta} /></div>}
    </div>
  )
}

function ToolGroup({ turns, usageMeta }) {
  const [open, setOpen] = useState(false)
  const toolBlocks = turns.flatMap(t => t.blocks.filter(b => b.type === 'tool_use'))
  const toolCount = toolBlocks.length
  const names = toolBlocks.map(b => b.name)
  if (toolCount === 0) return <>{turns.map((t) => <TurnRow key={t.uuid} turn={t} />)}</>
  const preview = names.slice(0, 4).join(', ') + (names.length > 4 ? `, +${names.length - 4}` : '')
  const errorCount = toolBlocks.filter(b => b.result?.is_error).length
  return (
    <div className={`tool-group${errorCount > 0 ? ' error' : ''}`}>
      <button className="aux-toggle tool-group-toggle" onClick={() => setOpen((v) => !v)}>
        <span>{open ? '▾' : '▸'} {toolCount} tool call{toolCount === 1 ? '' : 's'}
          {preview && <span className="tool-group-preview"> · {preview}</span>}
          {errorCount > 0 && <span className="tool-group-errors"> · {errorCount} error{errorCount === 1 ? '' : 's'}</span>}
        </span>
        {usageMeta?.delta && <span className="tool-group-usage"><AccumUsage usageMeta={usageMeta} /></span>}
      </button>
      {open && (
        <div className="tool-group-body">
          {turns.map((t) => <TurnRow key={t.uuid} turn={t} />)}
        </div>
      )}
    </div>
  )
}


function Block({ block }) {
  if (block.type === 'text') {
    const cmd = parseCommand(block.text)
    if (cmd) {
      return (
        <div className="block-command">
          <span className="cmd-name">{cmd.name}</span>
          {cmd.args && <span className="cmd-args"> {cmd.args}</span>}
          {cmd.stdout && <div className="cmd-stdout">{cmd.stdout}</div>}
        </div>
      )
    }
    return (
      <div className="block-text markdown">
        <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
          {fenceBlocks(block.text)}
        </ReactMarkdown>
      </div>
    )
  }
  if (block.type === 'thinking') {
    if (!block.thinking) return <Label title="thinking" />
    return <Collapsible title="thinking" defaultOpen={false}><pre>{block.thinking}</pre></Collapsible>
  }
  if (block.type === 'tool_use') {
    return (
      <Collapsible title={`→ ${block.name}`}>
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
        <div className="tool-result-label">{block.is_error ? 'error:' : 'result:'}</div>
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
    return { title: `selection in ${a.ideName || 'IDE'} · ${path}:${range}`, body: a.content || '' }
  },
  opened_file_in_ide: (a) => ({ title: `opened in IDE · ${a.displayPath || a.filename || ''}`, body: null }),
  file: (a) => {
    const f = a.content?.file
    return { title: `file · ${a.displayPath || f?.filePath || a.filename || ''}`, body: f?.content ?? safeJson(a.content) }
  },
  skill_listing: (a) => ({ title: `skills (${a.skillCount ?? '?'})`, body: a.content || '', defaultOpen: false }),
  deferred_tools_delta: (a) => ({
    title: `deferred tools · +${a.addedNames?.length || 0} -${a.removedNames?.length || 0}`,
    body: safeJson({ added: a.addedNames, removed: a.removedNames }),
    defaultOpen: false,
  }),
}

function Attachment({ att }) {
  const render = ATTACHMENT_RENDERERS[att?.type]
  const { title, body, defaultOpen = false } = render ? render(att) : { title: `attachment · ${att?.type || 'unknown'}`, body: safeJson(att) }
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
  const [open, setOpen] = useState(defaultOpen)
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

function JsonBlock({ value }) {
  const md = '```json\n' + safeJson(value) + '\n```'
  return (
    <div className="block-text markdown">
      <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
        {md}
      </ReactMarkdown>
    </div>
  )
}

function safeJson(x) {
  try { return JSON.stringify(x, null, 2)
   } catch { return String(x)
   }
}


