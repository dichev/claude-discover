import fsp from 'node:fs/promises'
import { join } from 'node:path'
import { CLAUDE_REQUESTS_DIR } from '../paths.js'

const jsonBytes = x => x == null ? 0 : Buffer.byteLength(JSON.stringify(x))

// Reads the NDJSON request log written by bin/capture-requests-proxy.mjs and resolves its
// dedup scheme — system/tools/each message is stored in full ({ $hash, value }) only on first
// sight, then as { $ref } — so callers see every request exactly as it was sent to the API.
export class RequestsFile {
  constructor(sessionId, dir = CLAUDE_REQUESTS_DIR) {
    this.filePath = join(dir, `${sessionId}.requests.jsonl`)
  }

  // `range` is { start, end } epoch ms. Refs are resolved over the whole file before the
  // range filter — an out-of-range record may hold the $hash an in-range record refs.
  async read(range = null) {
    const raw = await fsp.readFile(this.filePath, 'utf8').catch(() => '')
    const hashes = new Map() // $hash → value
    const resolve = x =>
      x?.$hash ? (hashes.set(x.$hash, x.value), x.value)
      : x?.$ref ? hashes.get(x.$ref) ?? x // unknown ref (truncated log) stays a visible marker
      : x
    const wasSeen = x => !!x?.$ref && hashes.has(x.$ref)
    const records = []
    for (const line of raw.split('\n')) {
      if (!line) continue
      let rec
      try { rec = JSON.parse(line) } catch { continue }
      const req = rec.request
      if (req) {
        // $seen marks the parts that resolved from a $ref — content repeated from an earlier
        // request — so the UI can fade them and let what's new stand out.
        const $seen = { messages: (req.messages || []).map(wasSeen) }
        if (req.system != null) { $seen.system = wasSeen(req.system); req.system = resolve(req.system) }
        if (req.tools != null) { $seen.tools = wasSeen(req.tools); req.tools = resolve(req.tools) }
        if (req.messages) req.messages = req.messages.map(resolve)
        rec.$seen = $seen
        rec.reqSize = jsonBytes(req)
        rec.resSize = jsonBytes(rec.response)
      }
      records.push(rec)
    }
    if (!range) return records
    return records.filter(r => {
      const t = Date.parse(r.timestamp)
      return t >= range.start && t <= range.end
    })
  }
}
