import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
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
    if (it.type === 'instructions-loaded') {
      turns.push({
        uuid: `instr-${it.file_path}-${it.timestamp}`,
        role: 'instruction',
        isMeta: true,
        ts: it.timestamp ? Date.parse(it.timestamp) : null,
        model: null, usage: null, tokenDelta: null, tokenTotal: null,
        blocks: [{ type: 'instruction', it }]
      })
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


function normalizeContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.map((b) => (typeof b === 'string' ? { type: 'text', text: b } : b))
}

function groupTurns(turns) {
  const groups = []
  let bucket = null
  const flush = () => { if (bucket) { groups.push(bucket); bucket = null } }
  for (const t of turns) {
    if (t.role === 'instruction') {
      flush()
      groups.push({ kind: 'instruction', turn: t })
      continue
    }
    const hasText = t.blocks.some((b) => b.type === 'text')
    const hasAttachment = t.blocks.some((b) => b.type === 'attachment')
    if (hasText || (t.role === 'user' && hasAttachment)) {
      flush()
      groups.push({ kind: 'turn', turn: t })
    } else {
      if (!bucket) bucket = { kind: 'tools', turns: [] }
      bucket.turns.push(t)
    }
  }
  flush()
  return groups
}

export default function ConversationView({ items }) {
  const turns  = useMemo(() => flatten(items), [items])
  const groups = useMemo(() => groupTurns(turns), [turns])
  return (
    <div className="conversation">
      {groups.map((g, i) => (
        <LazyMount key={g.kind === 'tools' ? `tools-${i}` : g.turn.uuid} eager={i < 8} placeholderMinHeight={80}>
          {g.kind === 'turn'      ? <TurnRow turn={g.turn} />
           : g.kind === 'tools'   ? <ToolGroup turns={g.turns} />
           :                        <InstructionFile it={g.turn.blocks[0].it} showNote={groups[i - 1]?.kind !== 'instruction'} />}
        </LazyMount>
      ))}
    </div>
  )
}

const CONTEXT_ATTACHMENT_TYPES = new Set(['deferred_tools_delta', 'skill_listing', 'selected_lines_in_ide', 'diagnostics'])

function TurnRow({ turn }) {
  const contextBlocks = [], otherBlocks = []
  for (const b of turn.blocks) {
    const isContextAttachment = b.type === 'attachment' && CONTEXT_ATTACHMENT_TYPES.has(b.attachment?.type)
    if (isContextAttachment) contextBlocks.push(b); else otherBlocks.push(b);
  }
  return (
    <div className={`turn turn-${turn.role} ${turn.isMeta ? 'turn-meta-note' : ''}`}>
      <div className="turn-blocks">
        {contextBlocks.length > 0 && (
          <Collapsible className="attachment" defaultOpen={false}>
            {contextBlocks.map((b, i) => <Attachment key={i} att={b.attachment} />)}
          </Collapsible>
        )}
        {otherBlocks.map((b, i) => <Block key={i} block={b} />)}
      </div>
    </div>
  )
}

function ToolGroup({ turns }) {
  const [open, setOpen] = useState(false)
  const toolBlocks = turns.flatMap(t => t.blocks.filter(b => b.type === 'tool_use'))
  const toolCount = toolBlocks.length
  if (toolCount === 0) return <>{turns.map((t) => <TurnRow key={t.uuid} turn={t} />)}</>
  const errorCount = toolBlocks.filter(b => b.result?.is_error).length
  return (
    <div className={`tool-group${errorCount > 0 ? ' error' : ''}`}>
      <button className="aux-toggle tool-group-toggle" onClick={() => setOpen((v) => !v)}>
        <span>{open ? '▾' : '▸'} {toolCount} tool call{toolCount === 1 ? '' : 's'}
          {preview && <span className="tool-group-preview"> · {preview}</span>}
          {errorCount > 0 && <span className="tool-group-errors"> · {errorCount} error{errorCount === 1 ? '' : 's'}</span>}
        </span>
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

function InstructionFile({ it, showNote }) {
  const [open, setOpen] = useState(false)
  const title           = `${it.file_path} (${it.memory_type}, ${it.hook_event_name} hook)`
  return (
    <div className="aux custom-event">
      {showNote && (
        <div className="instructions-note">
          Snapshotted by the capture context hook (<code>InstructionsLoaded</code> + <code>SessionStart</code>).
        </div>
      )}
      <button className="aux-toggle" onClick={() => setOpen(v => !v)}>
        <span className="aux-chevron">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
      </button>
      {open && (
        <div className="aux-body">
          {(it.parent_file_path || it.trigger_file_path || it.globs) && (
            <div className="initial-context-meta">
              {it.parent_file_path  && <div>included by: {it.parent_file_path}</div>}
              {it.trigger_file_path && <div>triggered by: {it.trigger_file_path}</div>}
              {it.globs?.length     && <div>matched globs: {it.globs.join(', ')}</div>}
            </div>
          )}
          {it.error
            ? <pre className="error">{it.error}</pre>
            : <div className="block-text markdown">
                <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{it.content || ''}</ReactMarkdown>
              </div>}
        </div>
      )}
    </div>
  )
}


