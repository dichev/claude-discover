import fsp from 'node:fs/promises'
import { join } from 'node:path'
import { REQUESTS_DIR } from '../../../bin/proxy.config.js'
import { RequestParser } from './RequestParser.js'

// The two sides spell an agent id differently, so compare a normalized key. An anonymous Task
// subagent is `a<16hex>` in both the transcript id and the header; a named teammate is
// `a<name>-<16hex>` in the transcript but `<name>@<team>` in the header.
const agentKey = id => id?.includes('@') ? id.slice(0, id.indexOf('@'))
  : id?.replace(/^a/, '').replace(/-[0-9a-f]{16}$/, '') ?? null

// Reads a session's NDJSON request log written by bin/proxy.mjs (RequestParser does the per-record work).
// Subagents share their parent's session id, so their requests land in the parent's file and are told
// apart only by the x-claude-code-agent-id header — `agentId` scopes a read to one agent (null = the session's own).
export class RequestFile {
  constructor(sessionId, { dir = REQUESTS_DIR, agentId = null } = {}) {
    this.filePath = join(dir, `${sessionId}.requests.jsonl`)
    this.agentKey = agentKey(agentId)
  }

  #mine(rec) {
    return agentKey(rec.requestHeaders?.['x-claude-code-agent-id'] ?? null) === this.agentKey
  }

  async lines() {
    const raw = await fsp.readFile(this.filePath, 'utf8').catch(() => '')
    return raw.split('\n').filter(Boolean)
  }

  // `range` is { start, end } epoch ms. Refs are resolved over the whole file before the range and
  // agent filters — an out-of-range (or another agent's) record may hold the $hash an in-range
  // record refs — so callers see every request exactly as it was sent to the API.
  async read(range = null) {
    const parser = new RequestParser()
    const records = []
    for (const line of await this.lines()) {
      let rec
      try { rec = JSON.parse(line) } catch { continue }
      records.push(parser.resolveRefs(rec))
    }
    return records.filter(r => {
      if (!this.#mine(r)) return false
      if (!range) return true
      const t = Date.parse(r.timestamp)
      return t >= range.start && t <= range.end
    })
  }

  // System prompts, tool definitions and memory files (CLAUDE.md / MEMORY.md / … from a user
  // message's `# claudeMd` system-reminder) — none of which the transcript records, so the request
  // log is the only source. Returns one record per unique prompt / tool batch / file_path.
  async readInstructions() {
    const parser = new RequestParser() // holds the per-tool dedup state
    const files = new Map() // dedup key → record, first sight wins
    for (const rec of await this.read()) {
      const record = f => ({ timestamp: rec.timestamp, ...f })
      const sys = parser.systemPrompt(rec)
      if (sys && !files.has(sys.hash)) files.set(sys.hash, record(sys))
      const tools = parser.systemTools(rec) // per-tool dedup — only not-yet-seen tools
      if (tools) files.set(tools.hash, record(tools))
      for (const f of parser.memoryFiles(rec)) {
        if (!files.has(f.file_path)) files.set(f.file_path, record(f))
      }
    }
    return [...files.values()]
  }
}
