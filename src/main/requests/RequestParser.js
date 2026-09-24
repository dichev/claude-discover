import crypto from 'node:crypto'
import { classifyRequest, splitClaudeMd, reminderLabel, DEFERRED_INTRO } from './claudeMarkers.js'

const jsonBytes = x => x == null ? 0 : Buffer.byteLength(JSON.stringify(x))

// Fingerprint of an instruction strip's content — its dedup key, and the renderer's list key.
const contentHash = s => crypto.createHash('sha256').update(s).digest('base64url').slice(0, 16)

// Tools an MCP server provides, namespaced by Claude Code as mcp__<server>__<tool>.
const isMcp = name => name.startsWith('mcp__')

// The kind of an instruction strip: side-channel requests (security monitor, title gen, …) keep
// their [kind, label]; main-loop requests (user message and tool-result continuations alike)
// collapse to a label-less 'main' — they ARE the conversation being read.
const stripKind = req => {
  const kind = classifyRequest(req)
  return !kind || kind[0] === 'main' || kind[0] === 'tools' ? ['main', null] : kind
}

// Every instruction strip has the same shape: a label the request's kind prefixes for side-channel
// calls, a content hash the caller dedups on, and the part of the request it was read from —
// `source`: 'system' | 'tools' | 'message' — which the frontend groups a request's strips by. The
// model is kept separate from the label — the frontend names it only when it differs from the
// conversation's own.
const toStrip = (rec, source, file_path, label, content) => {
  const [kind, kindLabel] = stripKind(rec.request)
  return { source, file_path, memory_type: [kindLabel, label].filter(Boolean).join(', '),
    model: rec.request.model, content, hash: contentHash(content), kind }
}

// an unresolvable ref (truncated log) is an object, not text — skipped
const texts = c => (Array.isArray(c) ? c.map(p => p?.text) : [c]).filter(t => typeof t === 'string')

// The text parts of every non-assistant message — an assistant reply quoting a reminder's shape
// must not parse as one the harness injected.
const injectedTexts = req => (req?.messages || []).filter(m => m?.role !== 'assistant').flatMap(m => texts(m.content))

// Record-level parsing of the NDJSON request log written by bin/proxy.mjs.
// Stateful: the log's dedup scheme stores system/tools/each message in full ({ $hash, value })
// only on first sight, then as { $ref } — so feed records in file order.
export class RequestParser {
  constructor() {
    this.hashes = new Map() // $hash → value
    this.seenTools = new Set() // tool names already returned by systemTools
    this.deferred = null // the session's deferred-tool roster, parsed from the first record that carries it
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

  // The request's system prompt, from a resolveRefs'd record — a plain string or an array of
  // text blocks, minus any CLAUDE.md section (those files are strips of their own, see memoryFiles).
  // The content hash is the dedup key: repeats collapse in the caller's map.
  systemPrompt(rec) {
    const sys = rec.request?.system
    if (sys == null || sys.$ref) return null // absent, or an unresolvable ref (truncated log)
    const content = typeof sys === 'string' ? splitClaudeMd(sys).rest : sys.map(b => splitClaudeMd(b?.text ?? '').rest).join('\n\n')
    return toStrip(rec, 'system', 'System Prompt', '', content)
  }

  // The deferred-tool roster Claude Code announces in the environment block of the first user
  // message: names it can call but whose schemas are left out of `tools` until ToolSearch pulls one
  // in. The list never appears in `tools`, so it is the only record of what a session declared but
  // never paid for. One roster per session — cached on first sight.
  deferredTools(rec) {
    if (this.deferred) return this.deferred
    for (const m of rec.request?.messages || []) {
      const content = m?.content
      for (const part of Array.isArray(content) ? content : [{ text: content }]) {
        const text = part?.text
        if (typeof text !== 'string') continue
        const intro = text.match(DEFERRED_INTRO)
        if (!intro) continue
        const names = []
        for (const line of text.slice(intro.index + intro[0].length).split(/\r?\n/)) {
          if (!/^[A-Za-z_]\w*$/.test(line)) break // one bare name per line; the list ends at the first line that isn't one
          names.push(line)
        }
        return (this.deferred = names)
      }
    }
    return []
  }

  // The roster as a strip of its own. Names only — a deferred tool has no schema in the request, so
  // this costs what the environment block's list costs, not what the tools would. Kept in announced
  // order, which already runs native names before MCP ones, and fenced so markdown keeps one name
  // per line instead of reflowing them all into one paragraph.
  deferredStrip(rec) {
    const names = this.deferredTools(rec)
    if (!names.length) return null
    const mcp = names.filter(isMcp).length
    // Counted per kind, named after the strip each would have joined had it loaded
    const count = (n, what) => n && `${n} deferred ${what} tool${n === 1 ? '' : 's'}`
    const label = [count(names.length - mcp, 'system'), count(mcp, 'MCP')].filter(Boolean).join(', ')
    return toStrip(rec, 'message', 'Deferred Tools', label, '```\n' + names.join('\n') + '\n```')
  }

  // The request's tool definitions, from a resolveRefs'd record, as a native and an MCP strip —
  // MCP schemas are often the bulk of a prompt, so they are worth costing on their own. The array
  // grows as deferred tools load mid-session, so only tools this parser hasn't seen yet are
  // returned — the first request yields the full set, later arrays just the additions.
  systemTools(rec) {
    const tools = rec.request?.tools
    if (!Array.isArray(tools)) return [] // absent, or an unresolvable ref (truncated log)
    const fresh = tools.filter(t => t?.name && !this.seenTools.has(t.name))
    for (const t of fresh) this.seenTools.add(t.name)
    // Schemas included: they are a large part of what a tool actually costs, so leaving them
    // out made the strip's token estimate far too low.
    const schema = t => t.input_schema ? '```json\n' + JSON.stringify(t.input_schema, null, 2) + '\n```' : ''
    const strip = (file_path, pick) => {
      const list = fresh.filter(t => pick(t.name)).map(t => ({ name: t.name, content: [t.description || '', schema(t)].filter(Boolean).join('\n\n') }))
      if (!list.length) return null
      const content = list.map(t => [`## ${t.name}`, t.content].filter(Boolean).join('\n\n')).join('\n\n')
      // `tools` keeps each definition apart, so the UI can fold them one by one
      return { ...toStrip(rec, 'tools', file_path, `${list.length} tool${list.length === 1 ? '' : 's'}`, content), tools: list }
    }
    return [strip('System Tools', n => !isMcp(n)), strip('MCP Tools', isMcp)].filter(Boolean)
  }

  // Memory files (CLAUDE.md / MEMORY.md / …) carried by a resolveRefs'd record — one
  // { source, file_path, memory_type, content } per file listed. Claude Code ships them in a user
  // message's system-reminder; an Agent SDK app can append the same section to the system prompt.
  memoryFiles(rec) {
    const req = rec.request
    const reminders = injectedTexts(req).filter(t => t.includes('<system-reminder>'))
    const from = (source, list) => list.flatMap(t => splitClaudeMd(t).files).map(f => ({ source, ...f }))
    return [...from('system', texts(req?.system)), ...from('message', reminders)]
  }

  // Every other <system-reminder> the harness injected into the messages — session context, git
  // status, environment, attribution rules, … — one strip each, minus what is already a strip of
  // its own: the CLAUDE.md files (cut out, which empties the reminder that only wraps them) and
  // the deferred-tool roster. Nothing the model was sent stays hidden.
  reminderStrips(rec) {
    const strips = []
    for (const text of injectedTexts(rec.request)) {
      for (const [, inner] of text.matchAll(/<system-reminder>([\s\S]*?)<\/system-reminder>/g)) {
        if (DEFERRED_INTRO.test(inner)) continue
        const content = splitClaudeMd(inner).rest.trim()
        if (content) strips.push(toStrip(rec, 'message', reminderLabel(content), 'system-reminder', content))
      }
    }
    return strips
  }
}
