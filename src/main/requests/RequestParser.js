import crypto from 'node:crypto'
import { classifyRequest, isLoop, splitClaudeMd, reminderView, DEFERRED_INTRO } from './claudeMarkers.js'

const jsonBytes = x => x == null ? 0 : Buffer.byteLength(JSON.stringify(x))

// Fingerprint of an instruction strip's content — its dedup key, and the renderer's list key.
const contentHash = s => crypto.createHash('sha256').update(s).digest('base64url').slice(0, 16)

// Tools an MCP server provides, namespaced by Claude Code as mcp__<server>__<tool>.
const isMcp = name => name.startsWith('mcp__')

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

// The kind of an instruction strip: side-channel requests (security monitor, title gen, …) keep
// their [kind, label]; main-loop requests (user message and tool-result continuations alike)
// collapse to a label-less 'main' — they ARE the conversation being read, as is a kind-less transcript record.
const stripKind = ({ kind }) => !kind || kind[0] === 'main' || kind[0] === 'tools' ? ['main', null] : kind

// Every instruction strip has the same shape: a label the request's kind prefixes for side-channel
// calls, a content hash it dedups on (see strips), and the part of the request it was read from —
// `source`: 'system' | 'tools' | 'message'. The
// model is kept separate from the label — the frontend names it only when it differs from the
// conversation's own.
const toStrip = (rec, source, file_path, label, content) => {
  const [kind, kindLabel] = stripKind(rec)
  return { source, file_path, memory_type: [kindLabel, label].filter(Boolean).join(', '),
    model: rec.request.model, content, hash: contentHash(content), kind }
}

// an unresolvable ref (truncated log) is an object, not text — skipped
export const texts = c => (Array.isArray(c) ? c.map(p => p?.text) : [c]).filter(t => typeof t === 'string')

// The text parts of every non-assistant message — an assistant reply quoting a reminder's shape
// must not parse as one the harness injected.
const injectedTexts = req => (req?.messages || []).filter(m => m?.role !== 'assistant').flatMap(m => texts(m.content))

// A tool that turns up mid-conversation (a late MCP server, a notification tool) is defined in a system
// message's tool_addition block, never in `tools`
const addedTools = req => (req?.messages || []).flatMap(m => Array.isArray(m?.content) ? m.content : [])
  .filter(p => p?.type === 'tool_addition' && p.tool?.type === 'tool_definition' && p.tool.definition).map(p => p.tool.definition)

// The API bills nothing for Claude Code's billing header, a system block of its own
const isBilled = text => !text.startsWith('x-anthropic-billing-header')

// Parses the proxy's request log and the transcript's request records. Stateful (the log stores each
// value once, then { $ref }s it; strips dedup by hash) — so feed records in file order.
export class RequestParser {
  constructor() {
    this.hashes = new Map() // $hash → value
    this.seenTools = new Map() // tool name → its definitions already returned by systemTools
    this.deferred = null // the session's deferred-tool roster, parsed from the first record that carries it
    this.deferredRoster = null // and its strip
    this.seenStrips = new Set() // hash of every strip returned by strips
  }

  // Every strip a request carries that this parser hasn't returned yet, in request order
  // (system → tools → messages) — first sight wins
  strips(rec) {
    const files = this.memoryFiles(rec)
    const found = [this.systemPrompt(rec), ...files.filter(f => f.source === 'system'), ...this.systemTools(rec),
      this.deferredStrip(rec), ...files.filter(f => f.source === 'message'), ...this.reminderStrips(rec)]
    return found.filter(f => {
      if (!f || this.seenStrips.has(f.hash)) return false
      this.seenStrips.add(f.hash)
      return true
    })
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
  systemPrompt(rec) {
    const sys = rec.request?.system
    if (sys == null || sys.$ref) return null // absent, or an unresolvable ref (truncated log)
    const content = typeof sys === 'string' ? splitClaudeMd(sys).rest : sys.map(b => b?.text ?? '').filter(isBilled).map(t => splitClaudeMd(t).rest).join('\n\n')
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
          if (!/^[A-Za-z_][\w-]*$/.test(line)) break // one bare name per line; the list ends at the first line that isn't one
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
  // per line instead of reflowing them all into one paragraph. Built once, like the roster — every
  // later request would only rebuild the same strip for strips() to drop as already seen.
  deferredStrip(rec) {
    if (this.deferredRoster) return this.deferredRoster
    const names = this.deferredTools(rec)
    if (!names.length) return null
    const mcp = names.filter(isMcp).length
    // Counted per kind, named after the strip each would have joined had it loaded
    const count = (n, what) => n && plural(n, `deferred ${what} tool`)
    const label = [count(names.length - mcp, 'system'), count(mcp, 'MCP')].filter(Boolean).join(', ')
    const fence = list => '```\n' + list.join('\n') + '\n```'
    // No descriptions to fold, so the names fold per source instead: the system ones, then each MCP server's
    const groups = Map.groupBy(names, n => isMcp(n) ? `${n.split('__')[1]} MCP` : 'System')
    const items = [...groups].map(([name, list]) => ({ name, memory_type: plural(list.length, 'tool'), content: fence(list) }))
    return (this.deferredRoster = { ...toStrip(rec, 'message', 'Deferred Tools', label, fence(names)), items, count: names.length })
  }

  // The request's tool definitions, from a resolveRefs'd record, as a native and an MCP strip —
  // MCP schemas are often the bulk of a prompt, so they are worth costing on their own. The array
  // grows as deferred tools load mid-session, so only tools this parser hasn't seen yet are
  // returned — the first request yields the full set, later arrays just the additions. A seen tool
  // defined anew is returned again, as changed: the tools lead the request, so the prompt cache is
  // rewritten from there (the SDK's StructuredOutput takes each turn's answer schema).
  systemTools(rec) {
    const listed = rec.request?.tools // absent, or an unresolvable ref (truncated log), where the tools aren't an array
    const tools  = [...Array.isArray(listed) ? listed : [], ...addedTools(rec.request)]
    // Schemas included: they are a large part of what a tool actually costs, so leaving them
    // out made the strip's token estimate far too low.
    const json = v => '```json\n' + JSON.stringify(v, null, 2) + '\n```'
    const schema = t => t.input_schema ? json(t.input_schema) : ''
    // Server tools (web_search, …) carry no description or schema — their definition is all there is
    const definition = ({ name, ...rest }) => json(rest)
    // A side request is a request of its own, whose tools differ from the loop's without changing them
    const loop  = isLoop(rec.kind)
    const fresh = []
    for (const t of tools.filter(t => t?.name)) {
      const content = [t.description || '', schema(t)].filter(Boolean).join('\n\n') || definition(t)
      const seen    = this.seenTools.get(t.name)
      if (seen && (!loop || seen.has(content))) continue
      // `deferred`: found through ToolSearch, whose result is what puts the definition in the context
      fresh.push({ name: t.name, content, ...t.defer_loading && { deferred: true }, ...seen && { memory_type: 'changed', changed: true } })
      this.seenTools.set(t.name, (seen ?? new Set()).add(content))
    }
    const strip = (file_path, pick) => {
      const list = fresh.filter(t => pick(t.name))
      if (!list.length) return null
      const changed = list.filter(t => t.changed).length
      const added   = list.length - changed
      const label   = [added && plural(added, 'tool'), changed && `${changed} changed`].filter(Boolean).join(', ')
      const content = list.map(t => [`## ${t.name}`, t.content].filter(Boolean).join('\n\n')).join('\n\n')
      // `items` keeps each definition apart, so the UI can fold them one by one
      return { ...toStrip(rec, 'tools', file_path, label, content), items: list, count: added, changed }
    }
    return [strip('System Tools', n => !isMcp(n)), strip('MCP Tools', isMcp)].filter(Boolean)
  }

  // Memory files (CLAUDE.md / MEMORY.md / …) carried by a resolveRefs'd record — one
  // { source, file_path, memory_type, content } per file listed. Claude Code ships them in a user
  // message's system-reminder; an Agent SDK app can append the same section to the system prompt.
  memoryFiles(rec) {
    const req = rec.request
    const reminders = injectedTexts(req).filter(t => t.includes('<system-reminder>'))
    // hashed with its path, so an edited file is sent anew but two files alike in content stay apart
    const from = (source, list) => list.flatMap(t => splitClaudeMd(t).files).map(f => ({ source, ...f, hash: contentHash(`${f.file_path}\n${f.content}`) }))
    return [...from('system', texts(req?.system)), ...from('message', reminders)]
  }

  // Every other <system-reminder> the harness injected into the messages — session context, git
  // status, environment, attribution rules, … — one strip each, minus what is already a strip of
  // its own: the CLAUDE.md files (cut out, which empties the reminder that only wraps them) and
  // the deferred-tool roster. Nothing the model was sent stays hidden.
  reminderStrips(rec) {
    const strips = []
    for (const text of injectedTexts(rec.request)) {
      // The harness ends the opening tag with a newline; a tag mid-sentence is prompt text quoting one
      for (const [, inner] of text.matchAll(/<system-reminder>\r?\n([\s\S]*?)<\/system-reminder>/g)) {
        if (DEFERRED_INTRO.test(inner)) continue
        const content = splitClaudeMd(inner).rest.trim()
        if (!content) continue
        const { label, unit, intro, items, outro } = reminderView(content)
        const strip = toStrip(rec, 'message', label, items.length ? plural(items.length, unit) : 'system-reminder', content)
        strips.push(items.length ? { ...strip, intro, items, outro } : strip)
      }
    }
    return strips
  }
}
