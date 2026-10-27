import { fmtCompact, plural } from '../../utils/formatting.js'
import { listedEntries, mcpSections } from '../../../shared/listings.js'

// How transcript records read on screen: titles and parsed tags, shared by ConversationView,
// MarkdownSession and the session list.

// "stop_hook_summary" → "Stop hook summary"
export const humanize = type => type.replace(/[_-]/g, ' ').replace(/^./, c => c.toUpperCase())

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

export const isClearTurn = t => t.blocks.some(b => b.type === 'text' && parseCommand(b.text)?.name === '/clear')

// Saved as `<sessionId>/tool-results/<file>` beside the top-level transcript (subagents save into their parent's) —
// linked relative to it so WSL paths resolve
export function persistedOutput(text) {
  if (typeof text !== 'string' || !text.trimStart().startsWith('<persisted-output>')) return null
  const saved = text.match(/Full output saved to: (.+)/)?.[1].trim()
  return saved ? { path: saved, href: saved.split(/[\\/]/).slice(-3).map(encodeURIComponent).join('/') } : null
}

// A side request's Proxy block, as told apart from the conversation
export const SIDE_NOTE = 'separate request, not in context'

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

export function safeJson(x) {
  try { return JSON.stringify(x, null, 2) } catch { return String(x) }
}

// An attachment's title and the text the model read (`body`), plus its listed `items` when it lists tools, skills or servers
const ATTACHMENT_RENDERERS = {
  selected_lines_in_ide: a => {
    const path = a.displayPath || a.filename || ''
    const range = a.lineStart === a.lineEnd ? `L${a.lineStart}` : `L${a.lineStart}-${a.lineEnd}`
    return { title: `Selection in ${a.ideName || 'IDE'}: ${path}:${range}`, body: a.content || '' }
  },
  opened_file_in_ide: a => ({ title: `Opened in IDE: ${a.displayPath || a.filename || ''}`, body: null }),
  file: a => {
    const f = a.content?.file
    return { title: `File: ${a.displayPath || f?.filePath || a.filename || ''}`, body: f?.content ?? safeJson(a.content) }
  },
  skill_listing: a => ({ title: `${a.skillCount} skills`, body: a.content || '', ...listedEntries(a.content || '') }),
  deferred_tools_delta: a => ({
    title: `${a.addedNames?.length || 0} deferred tools ${a.removedNames?.length ? `(removed: ${a.removedNames.length})` : ''}`,
    body: safeJson({ added: a.addedNames, removed: a.removedNames }),
  }),
  // The tools ToolSearch loaded — their schemas reach the model in the request's tools, not through this record
  deferred_tools_record: a => ({
    title: `Deferred tools record${a.entries?.length ? `: ${a.entries.map(e => e.name).join(', ')}` : ''}`,
    body: safeJson(a.entries?.length ? a.entries : a),
  }),
  prompt_snapshot: a => ({
    title: `Prompt snapshot: system prompt, ${a.tools?.length ?? 0} tools`,
    body: [...(a.systemPrompt ?? []), `Tools: ${(a.tools ?? []).map(t => t.name).join(', ')}`].join('\n\n'),
  }),
  // The one nested shape the fallback below can't flatten: files → diagnostics → range.
  diagnostics: a => {
    const lines = (a.files || []).flatMap(f => (f.diagnostics || [])
      .map(d => `${f.uri}:${(d.range?.start?.line ?? 0) + 1} ${d.severity}: ${d.message}${d.source ? ` (${d.source})` : ''}`))
    return { title: `Diagnostics: ${lines.length} in ${a.files?.length || 0} file${a.files?.length === 1 ? '' : 's'}`, body: lines.join('\n') }
  },
  // Directives whose text the fallback below would bury in raw JSON or drop
  hook_success:              a => ({ title: `Hook: ${a.hookName}`, body: a.content || safeJson(a) }),
  hook_additional_context:   a => ({ title: `Hook context: ${a.hookName}`, body: [a.content].flat().join('\n\n') }),
  hook_blocking_error:       a => ({ title: `Hook blocked: ${a.hookName}`, body: a.blockingError?.blockingError ?? safeJson(a.blockingError) }),
  hook_stopped_continuation: a => ({ title: `Hook stopped: ${a.hookName}`, body: a.message }),
  queued_command:            a => ({
    title: a.origin?.from ? `Message from ${a.origin.from}` : humanize(a.origin?.kind ?? a.commandMode ?? 'queued_command'),
    body: typeof a.prompt === 'string' ? a.prompt : safeJson(a.prompt),
  }),
  max_turns_reached:         a => ({ title: `Max turns reached (${a.maxTurns})`, body: null }),
  // addedLines carry each agent's one-line description; only the rendered text has the list's intro and closing
  // (concurrency) note, so it's read from that when the record has it.
  agent_listing_delta: (a, rendered) => {
    const body = rendered || (a.addedLines || a.addedTypes || []).join('\n')
    return {
      title: `${a.addedTypes?.length || 0} agent types${a.removedTypes?.length ? ` (removed: ${a.removedTypes.length})` : ''}`,
      body,
      ...listedEntries(body),
    }
  },
  // addedBlocks are each server's instructions under a `## <server>` heading
  mcp_instructions_delta: a => {
    const body = (a.addedBlocks || []).join('\n\n')
    return {
      title: `MCP instructions: ${plural(a.addedNames?.length || 0, 'server')}${a.removedNames?.length ? ` (removed: ${a.removedNames.length})` : ''}`,
      body,
      ...mcpSections(body),
    }
  },
}

// Everything else — Claude Code keeps adding attachment types (reminders, mode switches, tips, …), so the
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
  const raw   = !long.length && short.length > 1
  return {
    title: detail ? `${label}: ${detail}` : label,
    body: long.length ? long.map(([, v]) => v).join('\n\n') : raw ? safeJson(att) : null,
    raw,
  }
}

// The text the model actually read for an attachment, minus the system-reminder wrapper
const renderedText = rendered => (rendered ?? []).map(r => r?.content).filter(c => typeof c === 'string').join('\n')
  .replace(/<\/?system-reminder>/g, '').trim()
export const attachmentView = (att, rendered) => (ATTACHMENT_RENDERERS[att?.type] ?? genericAttachment)(att, renderedText(rendered))
// A raw record dump is our rendering, not text the model read — counting it would be noise
export const hasText = view => view.body != null && !view.raw
