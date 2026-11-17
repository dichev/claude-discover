import { countTokens } from '../../../shared/tokenizer/claudeTokenizer.js'
import { blockTokens, contentText, groupOf } from '../view/transcript.js'
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

// Where a listed item counts: an MCP tool under its server, a plugin's skill under the plugin
function itemPlace(unit, name) {
  if (unit.key === 'messages') return ['messages', unit.name]
  if (unit.key === 'mcp') return ['mcp', name]
  if (unit.key === 'systemTools') {
    const server = mcpServer(name)
    return server ? ['mcpTools', server] : ['systemTools', name]
  }
  const from = plugin(name)
  return [unit.key, from ? `plugin ${from}` : 'Built-in & user']
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
  for (const unit of latest.values()) {
    if (!unit.items.length) add([unit.key, unit.name], blockTokens(unit.b))
    for (const it of unit.items.filter(it => !it.deferred || found.has(it.name))) {
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
