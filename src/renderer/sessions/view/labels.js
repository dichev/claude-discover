import { fmtCompact } from '../../utils/formatting.js'

// How transcript records read on screen: titles and parsed tags, shared by ConversationView,
// MarkdownSession and the session list.

// "stop_hook_summary" → "Stop hook summary"
export const humanize = type => type.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

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

// Saved as `<sessionId>/tool-results/<file>` beside the top-level transcript (subagents save into their parent's) —
// linked relative to it so WSL paths resolve
export function persistedOutput(text) {
  if (typeof text !== 'string' || !text.trimStart().startsWith('<persisted-output>')) return null
  const saved = text.match(/Full output saved to: (.+)/)?.[1].trim()
  return saved ? { path: saved, href: saved.split(/[\\/]/).slice(-3).map(encodeURIComponent).join('/') } : null
}

// The part of the request an instruction strip was read from (its `source`), as shown to the user —
// in the request's own order (system → tools → messages).
export const SOURCE_LABELS = { system: 'system prompt', tools: 'tools', message: 'user message' }

// One request's instruction strips split by source: [[label, strips], …], empty groups left out.
export function groupInstructions(strips) {
  return Object.entries(SOURCE_LABELS).map(([source, label]) => [label, strips.filter(it => it.source === source)]).filter(([, list]) => list.length)
}

// Instruction strip title: `name (memory_type)` — the request's model is named only when it
// differs from the conversation's own (currentModel), i.e. for side-channel requests like title gen.
export function instructionTitle(it, model) {
  const parts = [it.memory_type, it.model && it.model !== model && it.model].filter(Boolean).join(', ')
  return parts ? `${it.name ?? it.file_path} (${parts})` : (it.name ?? it.file_path)
}

// "Conversation compacted (manual · 188.4k context tokens before)" for a `compact` block
export function compactTitle({ trigger, preTokens }) {
  const detail = [trigger, preTokens && `${fmtCompact(preTokens)} context tokens before`].filter(Boolean).join(' · ')
  return detail ? `Conversation compacted (${detail})` : 'Conversation compacted'
}
