// The text markers Claude Code puts on the wire, coarse to fine: what a request is for (its system
// prompt / trailing message), the system-reminders it injects into user messages, and the memory
// files carried inside one of those. Pure text functions — RequestParser applies them to the proxy
// log's records.

const headline = line => line.length > 34 ? line.slice(0, 33).trimEnd() + '…' : line

// Classifies a request by url, or on /v1/messages by its system prompt / trailing user message —
// the body is the only thing that says what such a request is for. Returns [cssKind, label] for
// RequestsView, or null. Tolerates the log's dedup wrappers, so raw and resolved records both work.
export const classifyRequest = (req, url) => {
  if (url?.includes('/count_tokens')) return ['count', 'Token count']
  if (!req) return null
  const un = x => x?.value ?? x
  const sys = un(req.system)
  const sysText = (typeof sys === 'string' ? sys : Array.isArray(sys) ? sys.map(b => un(b)?.text ?? '').join('\n') : '').slice(0, 600)
  const last = (req.messages || []).map(un).findLast(m => m?.role === 'user')
  const content = un(last?.content)
  const blocks = Array.isArray(content) ? content.map(un) : null
  const user = (typeof content === 'string' ? content : blocks?.find(b => b?.type === 'text')?.text ?? '').trimStart().slice(0, 300)
  // /compact appends its instructions as an extra text block after the user's message, so look at the last text block
  const tail = (blocks?.findLast(b => b?.type === 'text')?.text ?? user).slice(0, 600)
  if (req.max_tokens === 1 || user.trim() === 'quota') return ['quota', 'Quota probe']
  // auto permission mode vets each tool call with a security-monitor prompt before running it
  if (sysText.includes('You are a security monitor') || user.startsWith('<transcript>')) return ['security', 'Auto-mode check']
  if (sysText.includes('Generate a concise, sentence-case title') || sysText.includes('You are naming a coding session')) return ['title', 'Session title']
  if (sysText.includes('performing a web search')) return ['web', 'Web search']
  if (user.startsWith('[SUGGESTION MODE')) return ['suggest', 'Suggestions']
  if (user.startsWith('Web page content')) return ['web', 'Web fetch']
  if (user.startsWith('Describe your most recent action')) return ['status', 'Status blurb']
  if (tail.includes('detailed summary of the conversation')) return ['compact', 'Compact']
  if (sysText.includes("built on Anthropic's Claude Agent SDK")) return ['agent', 'Subagent']
  const tools = un(req.tools)
  if (sysText && Array.isArray(tools) && !tools.length) {
    // A side channel we have no matcher for is named after its own opening line — the boilerplate
    // every Claude Code prompt starts with is skipped, so what's left is the line that says what it is for.
    const line = sysText.split('\n').map(l => l.trim())
      .find(l => l && !l.startsWith('x-anthropic-billing-header') && !l.startsWith('You are Claude Code'))
    return ['aux', line ? headline(line) : 'Side channel']
  }
  if (!sysText.includes('You are Claude Code')) return null // unrecognized request — leave unclassified
  // agentic-loop continuations feed back the previous turn's tool results, so the last
  // user-role message says what this request is: tool results, or a new human message
  const continues = !last || blocks?.some(b => b?.type === 'tool_result')
  return continues ? ['tools', 'Tool turn'] : ['main', 'User message']
}

// The reminders Claude Code injects into user messages, named by their opening line; an unlisted
// one is named after that line itself.
const REMINDER_LABELS = [
  ['As you answer the user',             'Session Context'],
  ['# Environment',                      'Environment'],
  ['Attribution for git commits',        'Attribution'],
  ['Available agent types',              'Agent Types'],
  ['The following skills are available', 'Skills'],
  ['# MCP Server Instructions',          'MCP Instructions'],
  ['You are powered by the model',       'Model'],
  ["Today's date",                       'Date'],
  ['While auto mode is active',          'Auto Mode'],
  ['## Auto Mode Active',                'Auto Mode'],
  ['[SYSTEM NOTIFICATION',               'Notification'],
  ['Other agents active',                'Agents'],
  ['<total_tokens>',                     'Token Budget'],
]

export const reminderLabel = text => {
  const line = text.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return REMINDER_LABELS.find(([open]) => line.startsWith(open))?.[1] ?? headline(line)
}

// The environment block's announcement of the deferred-tool roster — deferredTools reads the names
// after it, and reminderStrips skips the reminder that carries it (the roster is a strip of its own).
export const DEFERRED_INTRO = /deferred tools are now available[^\n]*:\r?\n/

// Short display names for the parenthesized descriptions Claude Code puts after each path.
const MEMORY_LABELS = {
  "user's private global instructions for all projects": 'User',
  'project instructions, checked into the codebase': 'Project',
  "user's private project instructions, not checked in": 'Local',
  "user's auto-memory, persists across conversations": 'Auto',
}

// The standard file each memory type lives in — matching paths display as just the basename
// (`name`); anything off-pattern keeps its full path.
const MEMORY_FILES = { User: 'CLAUDE.md', Project: 'CLAUDE.md', Local: 'CLAUDE.local.md', Auto: 'MEMORY.md' }

// Splits a text around its CLAUDE.md section: `files` is one { file_path, name, memory_type,
// content } per file listed there, `rest` the text with the whole section cut out — what a system
// prompt or reminder costs on its own once the files it carries are strips of their own.
//
// The section is the files listed after the anchor, each introduced by a "Contents of <path>
// (<description>):" line. Claude Code has shipped it two ways — as a `# claudeMd` key inside the
// context reminder, and (current) as a reminder of its own opening with the sentence — so either
// one anchors the start. File bodies may contain their own "# " headings, so the section end is
// detected only by known-safe boundaries: the next lowerCamelCase reminder key (# userEmail,
// # gitStatus, …), the reminder's closing IMPORTANT note, or </system-reminder>.
export function splitClaudeMd(text) {
  const marker = text.match(/\n# claudeMd\r?\n|Codebase and user instructions are shown below\./)
  if (!marker) return { files: [], rest: text }
  const start = marker.index + marker[0].length
  const ends = [/\n# [a-z][a-zA-Z0-9]*\r?\n/, /\n\s*IMPORTANT: this context/, /<\/system-reminder>/]
    .map(re => text.slice(start).search(re)).filter(i => i !== -1)
  const end = ends.length ? start + Math.min(...ends) : text.length
  const region = text.slice(start, end)
  const heads = [...region.matchAll(/^Contents of (.+?) \(([^)]*)\):\r?\n/gm)]
  const files = heads.map((h, i) => {
    const memory_type = MEMORY_LABELS[h[2]] ?? h[2]
    const base = h[1].split(/[\\/]/).pop()
    return {
      file_path: h[1],
      name: base === MEMORY_FILES[memory_type] ? base : h[1],
      memory_type,
      content: region.slice(h.index + h[0].length, heads[i + 1]?.index ?? region.length).trim(),
    }
  })
  return { files, rest: (text.slice(0, marker.index) + text.slice(end)).trimEnd() }
}
