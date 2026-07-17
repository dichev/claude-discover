import fsp from 'node:fs/promises'
import { join } from 'node:path'
import { CLAUDE_REQUESTS_DIR } from '../paths.js'
import { RequestParser } from './RequestParser.js'

// Reads a session's NDJSON request log written by bin/capture-requests-proxy.mjs;
// RequestParser handles the per-record work (ref resolution, memory-file extraction).
export class RequestFile {
  constructor(sessionId, dir = CLAUDE_REQUESTS_DIR) {
    this.filePath = join(dir, `${sessionId}.requests.jsonl`)
  }

  async lines() {
    const raw = await fsp.readFile(this.filePath, 'utf8').catch(() => '')
    return raw.split('\n').filter(Boolean)
  }

  // `range` is { start, end } epoch ms. Refs are resolved over the whole file before the
  // range filter — an out-of-range record may hold the $hash an in-range record refs —
  // so callers see every request exactly as it was sent to the API.
  async read(range = null) {
    const parser = new RequestParser()
    const records = []
    for (const line of await this.lines()) {
      let rec
      try { rec = JSON.parse(line) } catch { continue }
      records.push(parser.resolveRefs(rec))
    }
    if (!range) return records
    return records.filter(r => {
      const t = Date.parse(r.timestamp)
      return t >= range.start && t <= range.end
    })
  }

  // System prompts (request.system) and memory files (CLAUDE.md / MEMORY.md / … inside a user
  // message's `# claudeMd` system-reminder) — the request log is the only place they're all
  // recorded (the InstructionsLoaded hook misses some, and never sees the system prompt at all).
  // Returns one record per unique system prompt / file_path, shaped like the capture-context
  // hook's records (plus origin:'request') so the renderer treats both sources alike.
  async readInstructions() {
    const parser = new RequestParser()
    const files = new Map() // dedup key → record, first sight wins
    for (const line of await this.lines()) {
      // cheap pre-filters; repeats are $refs, the full text appears once per unique value
      const hasSystem = line.includes('"system":{"$hash"')
      if (!hasSystem && !line.includes('# claudeMd')) continue
      let rec
      try { rec = JSON.parse(line) } catch { continue }
      const record = f => ({ type: 'instructions-loaded', origin: 'request', timestamp: rec.timestamp, ...f })
      const sys = hasSystem && parser.systemPrompt(rec)
      if (sys && !files.has(sys.hash)) files.set(sys.hash, record(sys))
      for (const f of parser.memoryFiles(rec)) {
        if (!files.has(f.file_path)) files.set(f.file_path, record(f))
      }
    }
    return [...files.values()]
  }
}
