import fsp from 'node:fs/promises'
import { join } from 'node:path'
import { REQUESTS_DIR } from '../../../bin/proxy.config.js'
import { RequestParser } from './RequestParser.js'
import { isLoop } from './claudeMarkers.js'

// The two sides spell an agent id differently, so compare a normalized key. An anonymous Task
// subagent is `a<16hex>` in both the transcript id and the header; a named teammate is
// `a<name>-<16hex>` in the transcript but `<name>@<team>` in the header.
const agentKey = id => id?.includes('@') ? id.slice(0, id.indexOf('@'))
  : id?.replace(/^a/, '').replace(/-[0-9a-f]{16}$/, '') ?? null

// `range` is { start, end } epoch ms, null for no bounds
const inRange = (timestamp, range) => {
  if (!range) return true
  const t = Date.parse(timestamp)
  return t >= range.start && t <= range.end
}

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
    return records.filter(r => this.#mine(r) && inRange(r.timestamp, range))
  }

  // What the side requests (title, auto-mode check, …) first sent, which the transcript doesn't log.
  // The loop's requests still claim theirs, so a fork of the conversation (suggestions) adds nothing.
  async readInstructions(range = null) {
    const parser = new RequestParser() // holds the dedup state
    const strips = []
    for (const rec of await this.read()) {
      // body-less (older proxy, unparsable body) has nothing to read; a count_tokens probe would claim the loop's strips
      if (!rec.request || rec.kind?.[0] === 'count') continue
      const found = parser.strips(rec)
      if (!isLoop(rec.kind) && inRange(rec.timestamp, range)) strips.push(...found.map(f => ({ timestamp: rec.timestamp, ...f })))
    }
    return strips
  }
}
