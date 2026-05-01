import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { fmtCompact } from '../utils/formatting'
import './ConversationView.css'

function flatten(items) {
  const turns = []
  const results = {}
  for (const it of items) {
    if (it.type === 'attachment' && it.attachment) {
      const block = { type: 'attachment', attachment: it.attachment }
      const last = turns[turns.length - 1]
      if (last && last.role === 'user') {
        last.blocks.push(block)
      } else {
        turns.push({
          uuid: it.uuid,
          role: 'user',
          isMeta: false,
          ts: it.timestamp ? Date.parse(it.timestamp) : null,
          model: null,
          usage: null,
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
    let cumulative = 0
    return groups.map(g => {
      let delta = null
      if (g.kind === 'turn') {
        if (g.turn.tokenDelta != null) delta = g.turn.tokenDelta
      } else {
        for (const t of g.turns) {
          if (t.tokenDelta != null) delta = (delta ?? 0) + t.tokenDelta
        }
      }
      if (delta != null) cumulative += delta
      return { g, usageMeta: cumulative > 0 ? { total: cumulative, delta } : null }
    })
  }, [groups])
  if (turns.length === 0) {
    return <div className="empty">No user/assistant turns to display.</div>
  }
  return (
    <div className="conversation">
      {groupsWithMeta.map(({ g, usageMeta }, i) => g.kind === 'turn'
        ? <TurnRow key={g.turn.uuid} turn={g.turn} usageMeta={usageMeta} />
        : <ToolGroup key={i} turns={g.turns} usageMeta={usageMeta} />
      )}
    </div>
  )
}

const CONTEXT_ATTACHMENT_TYPES = new Set(['deferred_tools_delta', 'skill_listing', 'selected_lines_in_ide'])

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

function parseCommand(text) {
  if (typeof text !== 'string' || !text.includes('<command-name>')) return null
  const name = text.match(/<command-name>([\s\S]*?)<\/command-name>/)
  if (!name) return null
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)
  const stdout = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)
  return {
    name: name[1].trim(),
    args: args ? args[1].trim() : '',
    stdout: stdout ? stdout[1].trim() : ''
  }
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
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {fenceJsonBlocks(block.text)}
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
      <span className="aux-label">• {title}</span>
    </div>
  )
}

function Collapsible({ title, children, className, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`aux ${className || ''}`}>
      <button className="aux-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} {title}
      </button>
      {open && <div className="aux-body">{children}</div>}
    </div>
  )
}

function JsonBlock({ value }) {
  const md = '```json\n' + safeJson(value) + '\n```'
  return (
    <div className="block-text markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
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

function fenceJsonBlocks(text) {
  if (typeof text !== 'string') return text
  return text.replace(/(^|\n)([{[][\s\S]*[}\]])(?=\n|$)/g, (m, sep, body) => {
    try {
      const parsed = JSON.parse(body)
      if (parsed && typeof parsed === 'object') {
        return sep + '```json\n' + JSON.stringify(parsed, null, 2) + '\n```'
      }
    } catch {}
    return m
  })
}
