// Pure transcript model, shared by ConversationView (rendering) and MarkdownSession (agent
// payload): raw session items → turns (flatten) → row groups (groupTurns) → per-group stats.

// `instructions` are the system prompts / memory files captured by the request proxy
// (readSession's separate `instructions` list) — not transcript items, merged in by timestamp.
export function flatten(items, instructions = []) {
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
        // Side the meta belongs to: attachments after an assistant or tool turn (between tool cycles)
        // are part of what the assistant just produced/received; otherwise they sit with the user.
        turns.push({
          uuid: it.uuid,
          role: (last?.role === 'assistant' || last?.role === 'tool') ? 'assistant' : 'user',
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
    // Workflow journal records (subagents/workflows/<wf>/journal.jsonl): each `result` carries an
    // agent's return value — render it as an assistant turn; `started` markers have no content and
    // fall through to the skip below.
    if (it.type === 'result' && it.key && it.agentId) {
      const text = typeof it.result === 'string' ? it.result : '```json\n' + JSON.stringify(it.result, null, 2) + '\n```'
      turns.push({
        uuid: `wf-${it.agentId}`,
        role: 'assistant',
        isMeta: false,
        ts: null,
        model: null, usage: null, tokenDelta: null, tokenTotal: null,
        blocks: [{ type: 'text', text: `**agent ${it.agentId}**\n\n${text}` }]
      })
      continue
    }
    if (it.type !== 'user' && it.type !== 'assistant') continue
    const msg = it.message || {}
    // Drop thinking blocks with no persisted text (signature-only reasoning — billed output tokens
    // but the plaintext isn't in the transcript). A turn left with nothing renders as an empty card.
    const blocks = normalizeContent(msg.content).filter(b => !(b.type === 'thinking' && !b.thinking?.trim()))
    if (blocks.length === 0) continue
    for (const b of blocks) {
      if (b.type === 'tool_result' && b.tool_use_id) results[b.tool_use_id] = b
    }
    // Anthropic's API has no `tool` role — tool_result blocks ride inside user messages.
    // Re-tag those turns as `tool` so they group with the assistant's tool calls, not the user.
    const role = it.type === 'user' && blocks.every(b => b.type === 'tool_result') ? 'tool' : it.type
    turns.push({
      uuid: it.uuid,
      role,
      isMeta: !!it.isMeta,
      ts: it.timestamp ? Date.parse(it.timestamp) : null,
      model: msg.model || null,
      msgId: msg.id || null,
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
  const out = turns.filter((t) => t.blocks.length > 0)
  // Slot each instruction in backdated 500ms, above the user message whose request carried it.
  for (const it of instructions) {
    const turn = {
      uuid: `instr-${it.hash ?? it.file_path}-${it.timestamp}`, // system prompts share a file_path, their hash disambiguates
      role: 'instruction',
      isMeta: true,
      ts: it.timestamp ? Date.parse(it.timestamp) - 500 : null,
      model: null, usage: null, tokenDelta: null, tokenTotal: null,
      blocks: [{ type: 'instruction', it }]
    }
    const i = out.findIndex(t => t.ts != null && t.ts > turn.ts)
    i === -1 ? out.push(turn) : out.splice(i, 0, turn)
  }
  return out
}

// The conversation's current model: what the last user message was answered with.
export const currentModel = turns => turns.findLast(t => t.model && t.model !== '<synthetic>')?.model

function normalizeContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.map((b) => (typeof b === 'string' ? { type: 'text', text: b } : b))
}

// One-line tool-call titles: an explicit `description` (Bash, Task) wins; standard
// tools derive one from their key argument. Unknown/MCP tools fall back to the bare name.
const clip = (s, n = 100) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const basename = p => p ? String(p).split(/[\\/]/).pop() : ''

const TOOL_ARG_SUMMARY = {
  Bash: i => i.command,
  Read: i => basename(i.file_path),
  Edit: i => basename(i.file_path),
  MultiEdit: i => basename(i.file_path),
  Write: i => basename(i.file_path),
  NotebookEdit: i => basename(i.notebook_path),
  Grep: i => [i.pattern, basename(i.path) || i.glob].filter(Boolean).join(' in '),
  Glob: i => [i.pattern, basename(i.path)].filter(Boolean).join(' in '),
  LS: i => basename(i.path),
  WebFetch: i => i.url,
  WebSearch: i => i.query,
  Skill: i => [i.skill, i.args].filter(Boolean).join(' '),
  SlashCommand: i => i.command,
  TodoWrite: i => i.todos?.find(t => t.status === 'in_progress')?.content || `${i.todos?.length ?? 0} todos`,
  AskUserQuestion: i => i.questions?.map(q => q.question).join(' · '),
  KillShell: i => i.shell_id,
  BashOutput: i => i.bash_id,
}

export function toolSummary(name, input) {
  const i = input || {}
  const summary = i.description || TOOL_ARG_SUMMARY[name]?.(i)
  return summary ? `${name}: ${clip(summary)}` : name
}

// CLI command output carries ANSI SGR/cursor codes (bold model names, the 256-color context-usage bar) — strip them for plain-text display.
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')

export function parseCommand(text) {
  if (typeof text !== 'string') return null
  // Anchored to the start: real command records begin with one of these tags (see SessionParser).
  // Prose that merely *mentions* a tag mid-text (e.g. an assistant reply discussing hooks) must
  // not parse as a command — it would render as an empty command block.
  if (!/^\s*<(command-name|command-message|local-command-stdout|local-command-caveat)>/.test(text)) return null
  const field = tag => stripAnsi(text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '')
  return {
    name:    field('command-name'),
    message: field('command-message'),
    args:    field('command-args'),
    stdout:  field('local-command-stdout'),
    caveat:  field('local-command-caveat'),
  }
}

// Instruction strip title: `name (memory_type)` — the request's model is named only when it
// differs from the conversation's own (currentModel), i.e. for side-channel requests like title gen.
export function instructionTitle(it, model) {
  const parts = [it.memory_type, it.model && it.model !== model && it.model].filter(Boolean).join(', ')
  return parts ? `${it.name ?? it.file_path} (${parts})` : (it.name ?? it.file_path)
}

// Harness-injected context is a meta turn whose blocks are all attachments (the "attachments · N items" payload).
export const isContextTurn = t => t.isMeta && t.blocks.every(b => b.type === 'attachment')

export function groupTurns(turns) {
  const groups = []
  let cycle = null  // open assistant card, closed by its next text message
  let pending = []  // held context turns, claimed by the next group
  const flush = () => { if (cycle) { groups.push(cycle); cycle = null } }
  for (const t of turns) {
    // Context between cycles belongs to a user message (shown as a summary in its header):
    // fold it into the one just above, or hold it for the next one — IDE selections land
    // in the transcript *before* the message they accompany.
    if (isContextTurn(t) && !cycle) {
      if (groups.at(-1)?.kind === 'user') groups.at(-1).turns.push(t)
      else pending.push(t)
    } else if (t.role === 'instruction') {
      flush()
      groups.push({ kind: 'instruction', turn: t })
    } else if (t.role === 'user') {
      flush()
      groups.push({ kind: 'user', turns: [...pending, t] })
      pending = []
    } else {
      // Tool calls/results, thinking and assistant-side meta accumulate into an assistant
      // card that closes at its next text message, so each message groups with its tool work.
      cycle ??= { kind: 'assistant', turns: pending.splice(0) }
      cycle.turns.push(t)
      if (t.blocks.some(b => b.type === 'text')) flush()
    }
  }
  flush()
  if (pending.length) groups.push({ kind: 'user', turns: pending }) // unclaimed context renders plainly
  return groups
}

// Response time per assistant cycle: from the previous row's last event to the cycle's last one.
export function cycleDurations(groups) {
  let prevEnd = null
  return groups.map(g => {
    const tss = (g.turns ?? [g.turn]).map(t => t.ts).filter(ts => ts != null)
    const end = tss.length ? tss[tss.length - 1] : null
    const duration = g.kind === 'assistant' && end != null && prevEnd != null ? end - prevEnd : null
    if (end != null) prevEnd = end
    return duration
  })
}

// One timeline point per group with usage: `+delta / total`. The delta is derived from
// consecutive running totals (not the stamped per-turn deltas) so the numbers always
// telescope — flatten drops turns whose blocks get absorbed elsewhere (e.g. tool_results
// merged into their tool_use), and their stamped deltas would otherwise go missing.
export function tokenPoints(groups) {
  let prev = 0
  return groups.map(g => {
    const turns = g.turns ?? [g.turn]
    let total = null, ctx = null
    // Split lines of one reply repeat its message id with cumulative usage snapshots,
    // so dedupe by id (last snapshot wins) before summing the group's API calls.
    const byMsg = new Map()
    for (const t of turns) {
      if (t.tokenTotal != null) total = t.tokenTotal
      const u = t.usage
      if (u) {
        ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
        byMsg.set(t.msgId ?? t.uuid, u)
      }
    }
    let usage = null
    for (const u of byMsg.values()) {
      usage ??= { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cacheCreation5m: 0, cacheCreation1h: 0 }
      usage.input += u.input_tokens || 0
      usage.output += u.output_tokens || 0
      usage.cacheRead += u.cache_read_input_tokens || 0
      usage.cacheCreation += u.cache_creation_input_tokens || 0
      usage.cacheCreation5m += u.cache_creation?.ephemeral_5m_input_tokens || 0
      usage.cacheCreation1h += u.cache_creation?.ephemeral_1h_input_tokens || 0
    }
    if (total == null || total === prev) return null
    const delta = total - prev
    prev = total
    // User (and tool-result) turns carry no `usage` object — the API only attaches usage to
    // assistant replies — but the delta *is* their context size: input tokens are stamped onto
    // whichever turn preceded the call that read them (see SessionParser#_stampRunningTotals).
    // Context injected after a user message is folded into its group, so its pre-call stamp lands
    // on the user turn's dot on the message's own timestamp.
    if (ctx == null && g.kind !== 'assistant') ctx = delta
    const ts = turns.find(t => t.ts != null)?.ts ?? null
    return { delta, total, ts, ctx, usage, role: g.kind === 'assistant' ? 'assistant' : turns[0].role }
  })
}
