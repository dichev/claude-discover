import { countTokens } from '../../../shared/tokenizer/claudeTokenizer.js'
import { contextSize } from '../../../shared/usage.js'
import { blockTokens, contentText, groupOf, groupTurns, rowIndex } from '../view/transcript.js'
import { blockView, humanize, isClearTurn, isCounted } from '../view/labels.js'

// Claude Desktop's categories, in a fixed order so the rows stay put. Its System tools is smaller and its Messages larger by Skills:
// /context takes them out of the tool definitions, though the listing is sent as a message; here each row counts what it holds
const CATEGORIES = {
  messages: 'Messages', systemTools: 'System tools', prompt: 'System prompt', memory: 'Memory files', skills: 'Skills',
  mcpTools: 'MCP tools', mcp: 'MCP server instructions',
}
const ORDER = Object.keys(CATEGORIES)

// The MCP server of a tool name (mcp__<server>__<tool>)
const mcpServer = name => name.match(/^mcp__(.+?)__/)?.[1]

const plugin = name => name.match(/^([\w.-]+):/)?.[1]

// A System row block's category, with the kind of Messages it counts as where Claude Desktop has no row for it:
// the deferred tools' names, the agent listing and the reminders Claude Code injects all reach the model as message text
function place(group, type) {
  if (type === 'Deferred Tools' || type === 'deferred_tools_delta') return ['messages', 'Deferred tool names']
  if (group === 'tools') return ['systemTools'] // system ones until their names say MCP
  if (group === 'listings') return type === 'Skills' || type === 'skill_listing' ? ['skills'] : ['messages', 'Agent types']
  if (group === 'context') return ['messages', 'Session context']
  return [group]
}

// A System row block as the breakdown counts it: what a re-send replaces (the system prompt, a memory file, a listing a retried
// prompt sends again word for word — the rest adds up, as tools and reminders do), its category, its name and listed items
const contextUnit = b => {
  const [key, kind] = place(groupOf(b), b.attachment?.type ?? b.it.file_path)
  if (b.type === 'attachment') {
    const view = blockView(b)
    return { b, id: view.body, key, name: kind ?? humanize(b.attachment.type), items: view.items ?? [] }
  }
  const { it } = b
  const id = key === 'prompt' || key === 'memory' ? it.file_path : it.hash
  return { b, id, key, name: kind ?? (it.name ? `${it.name}${it.memory_type ? ` (${it.memory_type})` : ''}` : it.file_path), items: it.items ?? [] }
}

// Where a listed item counts: an MCP tool under its server, a namespaced skill (plugin:skill) under its namespace
function itemPlace(unit, name) {
  if (unit.key === 'messages') return ['messages', unit.name]
  if (unit.key === 'mcp') return ['mcp', name]
  if (unit.key === 'systemTools') {
    const server = mcpServer(name)
    return server ? ['mcpTools', server] : ['systemTools', name]
  }
  const from = plugin(name)
  return [unit.key, from ?? 'Built-in & user']
}

// What a conversation block adds to the context, as [kind, text] pairs. The System rows' folded attachments are counted
// in their own categories already; images and encrypted thinking can't be sized from the transcript
function messageTexts(t, b) {
  if (t.role === 'compact') return [['Compact summary', b.summary]]
  if (b.type === 'text') return [[t.role === 'user' ? 'User messages' : t.role === 'assistant' ? 'Claude messages' : 'System messages', b.text]]
  if (b.type === 'thinking') return [['Thinking', b.thinking]]
  if (b.type === 'tool_use') return [['Tool calls', JSON.stringify(b.input)], ['Tool results', contentText(b.result?.content)]]
  if (b.type === 'tool_result') return [['Tool results', contentText(b.content)]]
  if (b.type === 'skill') return [['Tool results', b.text]]
  if (b.type === 'attachment' && isCounted(b) && !(t.role === 'system' && b.folded)) return [[t.role === 'system' ? 'System messages' : 'Attachments', blockView(b).body]]
  return []
}

// Messages' size split by kind: the System rows' own kinds (`listed`), then an estimate of `turns`, those since the last compaction.
// Past the size it scales down to fit; short of it the rest stays unsplit: what the API adds itself, earlier periods, images, encrypted thinking
function messageParts(turns, size, listed) {
  const sums = new Map(listed)
  for (const t of turns) {
    for (const b of t.blocks) {
      for (const [kind, text] of messageTexts(t, b)) {
        sums.set(kind, (sums.get(kind) ?? 0) + countTokens(text))
      }
    }
  }
  const estimated = [...sums.values()].reduce((a, n) => a + n, 0)
  const scale = Math.min(1, size / estimated)
  const list = [...sums].map(([name, n]) => ({ name, tokens: Math.round(n * scale) })).filter(c => c.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  if (size > estimated) list.push({ name: 'API overhead & unsplit', tokens: size - estimated })
  return list
}

// The conversation row `at` (its first turn's uuid): its group of turns and the index of its last one
function rowOf(turns, at) {
  const groups = groupTurns(turns)
  const group  = groups[rowIndex(groups, at)]
  return group && { group, end: turns.indexOf(group.turns.at(-1)) } // a group's turns run in order
}

// When the conversation row `at` ends: the time of the next turn, the row taking in all of a reply's streamed lines. null: it's the last.
// A compaction's row is read before it, as its context is
export function rowUntil(turns, at) {
  const row = rowOf(turns, at)
  if (row?.group.kind === 'compact' && row.group.turns[0].ts != null) return row.group.turns[0].ts
  return row ? turns.slice(row.end + 1).find(t => t.ts != null)?.ts ?? null : null
}

// The context holding the conversation row `at` as { turns, size }: the next request's, or the one a compaction before it cut (its own
// row's too), or where a rewind dropped the row, the last request before the rewind. null: no request since, the context now
export function contextAt(turns, at) {
  const row = rowOf(turns, at)
  if (!row) return null
  const before  = (i, size) => ({ turns: turns.slice(0, i), size })
  const latest  = Math.max(...row.group.turns.map(t => t.ts ?? 0))
  const dropped = rewind => rewind && (rewind.since == null || latest >= rewind.since)
  const own = row.group.kind === 'compact' && row.group.turns[0].blocks[0].preTokens
  if (own) return before(turns.indexOf(row.group.turns[0]), own)
  for (let i = row.end + 1; i < turns.length; i++) {
    const t = turns[i]
    if (t.role === 'compact' && t.blocks[0].preTokens) return before(i, t.blocks[0].preTokens)
    // only where the rewind dropped the row; a request from before a compaction didn't hold what came after it
    const last = dropped(t.rewind) && turns.slice(0, i).findLast(u => u.role === 'compact' || (u.usage && contextSize(u.usage)))?.usage
    if (last) return before(i, contextSize(last))
    const size = t.usage && contextSize(t.usage)
    if (size) return before(i, size)
  }
  return null
}

// What fills a context of `size` tokens, as categories of { name, tokens } parts: what its System rows list, then Messages as what's left
export function contextParts(turns, size) {
  const cut    = Math.max(0, turns.findLastIndex(t => t.role === 'compact' || isClearTurn(t)))
  const recent = turns.slice(cut)
  const units  = list => list.filter(t => t.role === 'system').flatMap(t => t.blocks)
    .filter(b => b.type === 'instruction' || (b.type === 'attachment' && b.folded && isCounted(b))).map(contextUnit)
  // A compaction or /clear drops the messages before it and what they carried: attachments, and the strips of a Messages kind sent again since.
  // The other strips from before it still count: they're listed only when first sent, so a re-send word for word shows nowhere
  const since  = units(recent)
  const again  = new Set(since.filter(u => u.key === 'messages').map(u => u.name))
  const kept   = units(turns.slice(0, cut)).filter(u => u.b.type === 'instruction' && !(u.key === 'messages' && again.has(u.name)))
  const latest = new Map([...kept, ...since].map(u => [u.id, u]))
  if (!latest.size) return []
  const groups = new Map()
  const add = ([key, name], tokens) => {
    if (!groups.has(key)) groups.set(key, new Map())
    const children = groups.get(key)
    children.set(name, (children.get(name) ?? 0) + tokens)
  }
  // A deferred tool's definition is in the context only through the ToolSearch result naming it, a message like the rest
  const found = new Set(recent.flatMap(t => t.blocks).flatMap(b => b.result?.content ?? b.content ?? []).filter(c => c?.type === 'tool_reference').map(c => c.tool_name))
  // A tool defined anew replaces its earlier definition
  const defined = new Map([...latest.values()].flatMap(u => u.key === 'systemTools' ? u.items.map(it => [it.name, it]) : []))
  for (const unit of latest.values()) {
    if (!unit.items.length) add([unit.key, unit.name], blockTokens(unit.b))
    const counted = unit.items.filter(it => (unit.key !== 'systemTools' || defined.get(it.name) === it) && (!it.deferred || found.has(it.name)))
    for (const it of counted) {
      add(itemPlace(unit, it.name), countTokens(`${it.name}: ${it.content}`))
    }
  }
  const listed = groups.get('messages')
  groups.delete('messages')
  const parts = [...groups].map(([key, children]) => {
    const list = [...children].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens)
    return { key, name: CATEGORIES[key], tokens: list.reduce((a, c) => a + c.tokens, 0), children: list }
  })
  const messages = size - parts.reduce((a, p) => a + p.tokens, 0)
  if (messages > 0) parts.push({ key: 'messages', name: CATEGORIES.messages, tokens: messages, children: messageParts(recent, messages, listed) })
  return parts.filter(p => p.tokens > 0).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
}

// The tokens the compactions of `turns` took out of a context now of `size` tokens: its size before each, as Claude Code logs it,
// less the next request's, `size` being the one after the last
export function compactedTokens(turns, size) {
  return turns.reduce((sum, t, i) => {
    const before = t.role === 'compact' && t.blocks[0].preTokens
    if (!before) return sum
    const next = turns.slice(i + 1).find(u => u.usage && contextSize(u.usage))
    return sum + Math.max(0, before - (next ? contextSize(next.usage) : size))
  }, 0)
}
