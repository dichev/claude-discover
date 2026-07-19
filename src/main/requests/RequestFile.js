import fsp from 'node:fs/promises'
import { join, basename } from 'node:path'
import { CLAUDE_REQUESTS_DIR } from '../paths.js'
import { RequestParser } from './RequestParser.js'

// Reads a session's NDJSON request log written by bin/capture-requests-proxy.mjs;
// RequestParser handles the per-record work (ref resolution, classification, memory-file extraction).
export class RequestFile {
  constructor(sessionId, dir = CLAUDE_REQUESTS_DIR) {
    this.filePath = join(dir, `${sessionId}.requests.jsonl`)
  }

  // Deletes request logs whose transcript is gone — a log is useless once Claude Code sweeps its
  // transcript (per cleanupPeriodDays), and following the transcript's fate needs no retention
  // math and can't race a session captured with the proxy off. `liveIds` must come from a
  // complete scan of projects/; logs touched within the last day are kept regardless, since a
  // brand-new session's transcript may not be on disk yet.
  static async sweepOrphans(liveIds, dir = CLAUDE_REQUESTS_DIR) {
    const cutoff = Date.now() - 24 * 60 * 60_000
    for (const name of await fsp.readdir(dir).catch(() => [])) {
      if (!name.endsWith('.requests.jsonl') || liveIds.has(basename(name, '.requests.jsonl'))) continue
      const filePath = join(dir, name)
      const stat = await fsp.stat(filePath).catch(() => null)
      if (stat && stat.mtimeMs < cutoff) await fsp.rm(filePath, { force: true }).catch(() => {})
    }
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

  // System prompts (request.system), tool definitions (request.tools) and memory files
  // (CLAUDE.md / MEMORY.md / … inside a user message's `# claudeMd` system-reminder) — none of
  // which Claude Code records in the session transcript, so the request log is the only source.
  // Returns one record per unique system prompt / tool batch / file_path; readSession ships them
  // alongside the transcript items.
  async readInstructions() {
    const parser = new RequestParser()
    const files = new Map() // dedup key → record, first sight wins
    for (const line of await this.lines()) {
      // cheap pre-filters; repeats are $refs, the full text appears once per unique value
      const hasSystem = line.includes('"system":{"$hash"')
      const hasTools = line.includes('"tools":{"$hash"')
      if (!hasSystem && !hasTools && !line.includes('# claudeMd')) continue
      let rec
      try { rec = JSON.parse(line) } catch { continue }
      const record = f => ({ timestamp: rec.timestamp, ...f })
      const sys = hasSystem && parser.systemPrompt(rec)
      if (sys && !files.has(sys.hash)) files.set(sys.hash, record(sys))
      const tools = hasTools && parser.systemTools(rec) // per-tool dedup — only not-yet-seen tools
      if (tools) files.set(tools.hash, record(tools))
      for (const f of parser.memoryFiles(rec)) {
        if (!files.has(f.file_path)) files.set(f.file_path, record(f))
      }
    }
    return [...files.values()]
  }
}
