const jsonBytes = x => x == null ? 0 : Buffer.byteLength(JSON.stringify(x))

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

// Extracts the files listed under a system-reminder's `# claudeMd` section, each introduced by a
// "Contents of <path> (<description>):" line. File bodies may contain their own "# " headings, so
// the section end is detected only by known-safe boundaries: the next lowerCamelCase reminder key
// (# userEmail, # gitStatus, …), the reminder's closing IMPORTANT note, or </system-reminder>.
export function parseClaudeMd(text) {
  const marker = '\n# claudeMd\n'
  const start = text.indexOf(marker)
  if (start === -1) return []
  let region = text.slice(start + marker.length)
  const ends = [/\n# [a-z][a-zA-Z0-9]*\r?\n/, /\n\s*IMPORTANT: this context/, /<\/system-reminder>/]
    .map(re => region.search(re)).filter(i => i !== -1)
  if (ends.length) region = region.slice(0, Math.min(...ends))
  const heads = [...region.matchAll(/^Contents of (.+?) \(([^)]*)\):\r?\n/gm)]
  return heads.map((h, i) => {
    const memory_type = MEMORY_LABELS[h[2]] ?? h[2]
    const base = h[1].split(/[\\/]/).pop()
    return {
      file_path: h[1],
      name: base === MEMORY_FILES[memory_type] ? base : h[1],
      memory_type,
      content: region.slice(h.index + h[0].length, heads[i + 1]?.index ?? region.length).trim(),
    }
  })
}

// Classifies a request by its url (count_tokens probes) or, on /v1/messages, by its system
// prompt / trailing user message — the body is the only thing that says what such a request is
// for. Returns [cssKind, label] (shown in RequestsView's list), or null when there's nothing to
// classify. Tolerates the log's dedup wrappers ({ $hash, value } / { $ref }), so it works on raw
// and resolved records.
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
  if (sysText.includes('You are a security monitor') || user.startsWith('<transcript>')) return ['security', 'Security check']
  if (sysText.includes('Generate a concise, sentence-case title')) return ['title', 'Session title']
  if (sysText.includes('performing a web search')) return ['web', 'Web search']
  if (user.startsWith('[SUGGESTION MODE')) return ['suggest', 'Suggestions']
  if (user.startsWith('Web page content')) return ['web', 'Web fetch']
  if (user.startsWith('Describe your most recent action')) return ['status', 'Status blurb']
  if (tail.includes('detailed summary of the conversation')) return ['compact', 'Compact']
  if (sysText.includes("built on Anthropic's Claude Agent SDK")) return ['agent', 'Subagent']
  if (!sysText.includes('You are Claude Code')) return null // unrecognized request — leave unclassified
  // agentic-loop continuations feed back the previous turn's tool results, so the last
  // user-role message says what this request is: tool results, or a new human message
  const continues = !last || blocks?.some(b => b?.type === 'tool_result')
  return continues ? ['tools', 'Tool turn'] : ['main', 'User message']
}

// The kind of an instruction strip: side-channel requests (security monitor, title gen, …) keep
// their [kind, label]; main-loop requests (user message and tool-result continuations alike)
// collapse to a label-less 'main' — they ARE the conversation being read.
const stripKind = req => {
  const kind = classifyRequest(req)
  return !kind || kind[0] === 'main' || kind[0] === 'tools' ? ['main', null] : kind
}

// Record-level parsing of the NDJSON request log written by bin/proxy.mjs.
// Stateful: the log's dedup scheme stores system/tools/each message in full ({ $hash, value })
// only on first sight, then as { $ref } — so feed records in file order.
export class RequestParser {
  constructor() {
    this.hashes = new Map() // $hash → value
    this.seenTools = new Set() // tool names already returned by systemTools
  }

  // Resolves $hash/$ref dedup wrappers at any depth — children first, so stored and returned
  // values are always fully resolved. Feed records in file order. When `seen` is given, the
  // dot-path of every resolved (known) $ref is pushed into it — 'system', 'messages.3.content.2', …
  resolve(v, path = '', seen = null) {
    if (v?.$hash) { const r = this.resolve(v.value, path, seen); this.hashes.set(v.$hash, r); return r }
    if (v?.$ref) {
      if (!this.hashes.has(v.$ref)) return v // unknown ref (truncated log) stays a visible marker
      seen?.push(path)
      return this.hashes.get(v.$ref)
    }
    if (Array.isArray(v)) return v.map((x, i) => this.resolve(x, `${path}.${i}`, seen))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.resolve(x, `${path}.${k}`, seen)]))
    return v
  }

  // Resolves the request's $hash/$ref parts back to full values in place, and annotates the
  // record with $seen — which parts repeated earlier content — so the UI can fade them:
  // `messages` flags whole-message repeats, `paths` every repeated node at any depth.
  resolveRefs(rec) {
    const wasSeen = x => !!x?.$ref && this.hashes.has(x.$ref)
    const req = rec.request
    if (req) {
      const paths = []
      rec.$seen = { messages: (req.messages || []).map(wasSeen), paths }
      if (req.system != null) req.system = this.resolve(req.system, 'system', paths)
      if (req.tools != null) req.tools = this.resolve(req.tools, 'tools', paths)
      if (req.messages) req.messages = req.messages.map((m, i) => this.resolve(m, `messages.${i}`, paths))
    }
    rec.kind = classifyRequest(req, rec.url)
    rec.reqSize = jsonBytes(req)
    rec.resSize = jsonBytes(rec.response)
    return rec
  }

  // The request's system prompt, only when this record logs it in full ({ $hash, value } — repeats
  // are $refs). `system` is either a plain string or an array of text blocks.
  systemPrompt(rec) {
    const sys = rec.request?.system
    if (!sys?.$hash) return null
    const value = this.resolve(sys.value) // blocks may be dedup-wrapped — a $ref'd block was stored by an earlier $hash record
    const content = typeof value === 'string' ? value : value.map(b => b?.text ?? '').join('\n\n')
    const [kind, kindLabel] = stripKind(rec.request)
    // model kept separate — the frontend shows it only when it differs from the conversation's
    return { file_path: 'System Prompt', memory_type: kindLabel || '', model: rec.request.model, content, hash: sys.$hash, kind }
  }

  // The request's tool definitions, only when this record logs the array in full (repeats are
  // $refs). The array grows as deferred tools load mid-session, so only tools this parser hasn't
  // seen yet are returned — the first request yields the full set, later arrays just the additions.
  systemTools(rec) {
    const tools = rec.request?.tools
    if (!tools?.$hash) return null
    const fresh = this.resolve(tools.value).filter(t => t?.name && !this.seenTools.has(t.name))
    if (!fresh.length) return null
    for (const t of fresh) this.seenTools.add(t.name)
    // Schemas included: they are a large part of what a tool actually costs, so leaving them
    // out made the strip's token estimate far too low.
    const schema = t => t.input_schema ? '```json\n' + JSON.stringify(t.input_schema, null, 2) + '\n```' : ''
    const content = fresh.map(t => [`## ${t.name}`, t.description || '', schema(t)].filter(Boolean).join('\n\n')).join('\n\n')
    const [kind, kindLabel] = stripKind(rec.request)
    const label = [kindLabel, `${fresh.length} tool${fresh.length === 1 ? '' : 's'}`].filter(Boolean).join(', ')
    return { file_path: 'System Tools', memory_type: label, model: rec.request.model, content, hash: tools.$hash, kind }
  }

  // Memory files (CLAUDE.md / MEMORY.md / …) carried by the record's messages inside `# claudeMd`
  // system-reminders — one { file_path, memory_type, content } per file listed.
  memoryFiles(rec) {
    const files = []
    for (const m of rec.request?.messages || []) {
      const content = (m?.value ?? m)?.content
      for (const part of Array.isArray(content) ? content : [{ text: content }]) {
        const text = (part?.value ?? part)?.text // blocks may be dedup-wrapped too; $refs repeat earlier content and resolve to undefined here
        if (typeof text !== 'string' || !text.includes('<system-reminder>')) continue
        files.push(...parseClaudeMd(text))
      }
    }
    return files
  }
}
