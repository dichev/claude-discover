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
  }

  // Resolves the request's $hash/$ref parts back to full values in place, and annotates the
  // record with $seen — which parts repeated earlier content — so the UI can fade them.
  resolveRefs(rec) {
    const resolve = x =>
      x?.$hash ? (this.hashes.set(x.$hash, x.value), x.value)
      : x?.$ref ? this.hashes.get(x.$ref) ?? x // unknown ref (truncated log) stays a visible marker
      : x
    const wasSeen = x => !!x?.$ref && this.hashes.has(x.$ref)
    const req = rec.request
    if (!req) return rec
    const $seen = { messages: (req.messages || []).map(wasSeen) }
    if (req.system != null) { $seen.system = wasSeen(req.system); req.system = resolve(req.system) }
    if (req.tools != null) { $seen.tools = wasSeen(req.tools); req.tools = resolve(req.tools) }
    if (req.messages) req.messages = req.messages.map(resolve)
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
    const content = typeof sys.value === 'string' ? sys.value : sys.value.map(b => b?.text ?? '').join('\n\n')
    return { file_path: 'System prompt', memory_type: rec.request.model, content, hash: sys.$hash }
  }

  // Memory files (CLAUDE.md / MEMORY.md / …) carried by the record's messages inside `# claudeMd`
  // system-reminders — one { file_path, memory_type, content } per file listed.
  memoryFiles(rec) {
    const files = []
    for (const m of rec.request?.messages || []) {
      const content = (m?.value ?? m)?.content
      for (const part of Array.isArray(content) ? content : [{ text: content }]) {
        if (typeof part?.text !== 'string' || !part.text.includes('<system-reminder>')) continue
        files.push(...parseClaudeMd(part.text))
      }
    }
    return files
  }
}
