const jsonBytes = x => x == null ? 0 : Buffer.byteLength(JSON.stringify(x))

// Short display names for the parenthesized descriptions Claude Code puts after each path.
const MEMORY_LABELS = {
  "user's private global instructions for all projects": 'User',
  'project instructions, checked into the codebase': 'Project',
  "user's auto-memory, persists across conversations": 'Auto',
}

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
  return heads.map((h, i) => ({
    file_path: h[1],
    memory_type: MEMORY_LABELS[h[2]] ?? h[2],
    content: region.slice(h.index + h[0].length, heads[i + 1]?.index ?? region.length).trim(),
  }))
}

// Record-level parsing of the NDJSON request log written by bin/capture-requests-proxy.mjs.
// Stateful: the log's dedup scheme stores system/tools/each message in full ({ $hash, value })
// only on first sight, then as { $ref } — so feed records in file order.
export class RequestParser {
  constructor() {
    this.hashes = new Map() // $hash → value
    this.seenTools = new Set() // tool names already returned by systemTools
  }

  // Resolves $hash/$ref dedup wrappers at any depth — children first, so stored and returned
  // values are always fully resolved. Feed records in file order.
  resolve(v) {
    if (v?.$hash) { const r = this.resolve(v.value); this.hashes.set(v.$hash, r); return r }
    if (v?.$ref) return this.hashes.get(v.$ref) ?? v // unknown ref (truncated log) stays a visible marker
    if (Array.isArray(v)) return v.map(x => this.resolve(x))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.resolve(x)]))
    return v
  }

  // Resolves the request's $hash/$ref parts back to full values in place, and annotates the
  // record with $seen — which parts repeated earlier content — so the UI can fade them.
  resolveRefs(rec) {
    const wasSeen = x => !!x?.$ref && this.hashes.has(x.$ref)
    const req = rec.request
    if (!req) return rec
    const $seen = { messages: (req.messages || []).map(wasSeen) }
    if (req.system != null) { $seen.system = wasSeen(req.system); req.system = this.resolve(req.system) }
    if (req.tools != null) { $seen.tools = wasSeen(req.tools); req.tools = this.resolve(req.tools) }
    if (req.messages) req.messages = req.messages.map(m => this.resolve(m))
    rec.$seen = $seen
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
    return { file_path: 'System Prompt', memory_type: rec.request.model, content, hash: sys.$hash }
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
    const content = fresh.map(t => `## ${t.name}\n\n${t.description || ''}`.trim()).join('\n\n')
    const label = `${rec.request.model}, ${fresh.length} tool${fresh.length === 1 ? '' : 's'}`
    return { file_path: 'System Tools', memory_type: label, content, hash: tools.$hash }
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
