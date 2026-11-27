import path from 'node:path'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO } from 'date-fns'
import { SessionFile } from './SessionFile.js'
import { RequestFile, inRange } from '../requests/RequestFile.js'
import { UNATTRIBUTED } from '../../../bin/proxy.config.js'
import { TranscriptInstructions } from '../requests/TranscriptInstructions.js'
import { USER_ATTACHMENTS } from '../../shared/attachments.js'
import { McpDebugLog } from './McpDebugLog.js'
import { McpTools } from './McpTools.js'
import { SessionParser, suffixLabels } from './SessionParser.js'
import { SessionsScanner } from './SessionsScanner.js'
import { MetaCache } from './MetaCache.js'
import { ProjectResolver } from './ProjectResolver.js'
import { Limiter } from './utils/Limiter.js'

// Week-scoped views start on Monday — keep in sync with src/renderer/utils/period.js.
const WEEK = { weekStartsOn: 1 }

export function periodBounds(date, granularity = 'day', tz = undefined) {
  const opts = { in: tz }
  const d = parseISO(date, opts)
  if (granularity === 'week') return { start: +startOfWeek(d, { ...WEEK, ...opts }), end: +endOfWeek(d, { ...WEEK, ...opts }) }
  if (granularity === 'month') return { start: +startOfMonth(d, opts), end: +endOfMonth(d, opts) }
  return { start: +startOfDay(d, opts), end: +endOfDay(d, opts) }
}

export const intersects = (meta, period) => meta.lastActivityAt >= period.start && meta.startedAt <= period.end

// seenMessageIds (one id per message) exists only for dedup here in main — drop it from
// everything leaving the reader, it's dead weight over IPC.
function stripInternal({ seenMessageIds, ...meta }) {
  return meta
}

// Transcripts parsed at once. A scan lists thousands, and each in flight holds its read buffers and its record being parsed
// (a tool result's image, a long prompt): all at once they outgrew the heap, where a handful parse as fast, the parse being CPU-bound
const PARSES = 16

// The id becomes a filename: same guard as the proxy
const isSafeId = id => /^[\w-]+$/.test(id)

// A subagent's connections are in its parent's debug log, so it lists only its transcript's
const debugLogOf = reader => reader.parentSessionId || !isSafeId(reader.sessionId) ? null : new McpDebugLog(reader.sessionId)

// What the transcripts hold, for whoever asks: a period's sessions, deduped and priced (scan), and one transcript's records (read, readFile).
// It holds nothing of who is asking, only caches (whole-file metas, the last branch's source), so its calls answer beside each other.
// The CLIs and tests use it alone; SessionsService keeps the window's period fresh on top of it.
// `pricing` is given by whoever builds it, as the parser's is: without one its sessions carry no cost.
export class SessionsReader {
  #branch = null // { key, source } of the last branch read
  #metas  = new MetaCache()
  #parses = new Limiter(PARSES)

  constructor({ root, scanner = null, pricing = null } = {}) {
    this.scanner = scanner ?? new SessionsScanner(root ? { root } : {})
    this.pricing = pricing
    this.projects = new ProjectResolver()
  }

  // The deduped sessions of `period` ({ start, end } epoch ms; see periodBounds), once the whole scan completes.
  // Answers from the files the scanner lists now, so a transcript deleted since the last scan is left out
  async scan(period) {
    const metas = []
    await this.scanner.scan(period, { onFile: async (filePath, stat) => metas.push(await this.meta(filePath, stat, period)) })
    return this.dedup(metas.filter(Boolean), period)
  }

  // One file's meta within `period`, or null when it has no activity there (see MetaCache for what is parsed when)
  meta(filePath, stat, period) {
    return this.#metas.resolve(filePath, stat, period, range => this.#parse(new SessionFile(filePath), { range, stat }))
  }

  // Forget a deleted file
  forget(filePath) {
    this.#metas.evict(filePath)
  }

  // Forget every meta, e.g. when a pricing change invalidates them all
  clear() {
    this.#metas.clear()
  }

  // The sessions among `all` active in `range`, latest first.
  // Resume/fork copies prior message.ids verbatim. Walk earliest-first; if a
  // session's ids overlap one already counted, rescan it with the overlap
  // excluded so it contributes only its NEW messages.
  async dedup(all, range) {
    const metas = [...all].filter(m => intersects(m, range)).sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    const sorted = [...metas].sort((a, b) => a.startedAt - b.startedAt)
    const globalSeen = new Set()
    const rescans = new Map()
    for (const m of sorted) {
      let overlap = null
      for (const id of m.seenMessageIds || []) {
        if (globalSeen.has(id)) (overlap ||= new Set()).add(id)
        globalSeen.add(id)
      }
      if (overlap) rescans.set(m.filePath, this.#parse(new SessionFile(m.filePath), { range, excludeIds: overlap }))
    }
    const sessions = await Promise.all(metas.map(async m => {
      const rescanned = await rescans.get(m.filePath)
      return stripInternal(rescanned ? { ...m, ...rescanned } : m)
    }))
    // Labels depend on which other projects are in the snapshot (same-named folders), so they're set here
    const labels = suffixLabels(sessions.map(m => m.project))
    for (const m of sessions) m.projectShort = m.tempPath ? 'Temp' : labels.get(m.project) // the macOS temp root is just "T"
    return sessions
  }

  // What was typed in the session `meta` is of within `range` (null: all of it), as a search reads it: read again from its file
  // when asked, as no meta keeps it (a period's prompts run to gigabytes, the agents' SDK runs each sending a long one)
  async prompts(meta, range = null) {
    const reader = new SessionFile(meta.filePath)
    const parser = new SessionParser({
      sessionId: reader.sessionId, parentSessionId: reader.parentSessionId, filePath: reader.filePath, mtime: meta.mtime, range, prompts: true,
    })
    await this.#parses.run(() => reader.stream(obj => parser.feed(obj)))
    return parser.prompts
  }

  // A transcript's meta outside any period: its totals are the whole file's, not deduped against a period's sessions
  async wholeMeta(filePath) {
    if (!filePath?.endsWith('.jsonl')) throw new Error(`Not a .jsonl transcript: ${filePath}`)
    const meta = await this.#parse(new SessionFile(filePath))
    if (!meta) throw new Error(`Can't read ${filePath}`)
    meta.projectShort = suffixLabels([meta.project]).get(meta.project)
    return stripInternal(meta)
  }

  // A transcript read whole, from anywhere on disk: its figures and its records, of all its days
  async readFile(filePath) {
    const meta = await this.wholeMeta(filePath)
    return { meta, ...await this.read(meta) }
  }

  // The records of the transcript `meta` is of, within `range` (null: all of them), and what its requests sent.
  // Always parses the whole file from 0: the parser's running token totals only stamp
  // correctly from a fresh start, so live updates re-read rather than resume at an offset.
  async read(meta, range = null) {
    const reader = new SessionFile(meta.filePath)
    const parser = new SessionParser({
      sessionId: reader.sessionId, parentSessionId: reader.parentSessionId, filePath: reader.filePath, mtime: meta.mtime, range,
    })
    // what the side requests (title, auto-mode check, …) sent, which only the capture proxy saw
    const requests = this.#requestFile(reader.sessionId, reader.parentSessionId)
    const sides = requests.readInstructions(range)
    const source = await this.#branchSource(meta)
    const items = []
    const transcript = new TranscriptInstructions()
    const mcpTools = new McpTools()
    const loop = []
    let start = null // what the conversation's first request sent — its context on any day
    // fed ahead of the range filter, so what was sent before the period isn't listed again
    const feed = (obj, shown) => {
      mcpTools.feed(obj)
      const strips = transcript.feed(obj)
      if (obj.type === 'api-request') start ??= strips
      if (shown) loop.push(...strips)
      return shown
    }
    for (const obj of source.records) feed(obj, inRange(obj.timestamp, range))
    await reader.stream(obj => { if (feed(obj, parser.feed(obj))) items.push(obj) })
    const own = await sides
    const shown = list => list.filter(s => inRange(s.timestamp, range))
    const side = [...own.strips, ...shown(source.side)]
    const compacts = [...shown(source.compacts), ...own.compacts] // in time order: the source's predate the branch
    if (start?.length && !loop.includes(start[0])) loop.unshift(...start)
    // .jsonl lines aren't always in timestamp order. An untimestamped one (permission-mode, ai-title, …) sorts by its file
    // neighbour: the timestamped line before it, or after it where it leads the file, not the mtime the parser falls back to
    const stamped = items.map(o => Date.parse(o.timestamp) > 0 ? o._ts : null)
    let prev = stamped.find(t => t != null)
    items.forEach((o, i) => { o._ts = prev = stamped[i] ?? prev ?? o._ts })
    items.sort((a, b) => a._ts - b._ts)
    const keys = new Set(loop.map(s => s.hash))
    const isBrought = o => USER_ATTACHMENTS.has(o.attachment?.type) // an @-mention, an IDE selection: shown with the prompt instead
    const brought = new Set(items.filter(isBrought).flatMap(o => TranscriptInstructions.injected(o)).map(f => f.hash))
    const loopStrips = loop.filter(s => !brought.has(s.hash))
    for (const o of items) {
      delete o._ts
      // already listed among the loop's strips, so the view leaves it out
      if (o.type === 'attachment' && !isBrought(o) && TranscriptInstructions.listed(o, keys)) o._listed = true
    }
    // Shipped apart from the transcript items, the renderer slots them in by timestamp: the loop's as
    // System rows, along with each turn's MCP servers, the side requests' as Proxy blocks.
    // The proxy's and debug logs are passed on for the AI agent to read.
    const mcp = mcpTools.turns(range)
    const debugLog = await debugLogOf(reader)?.fillIn(mcp, mcpTools.processStarts()) ?? null
    return { items, instructions: { loop: loopStrips, side, compacts, mcp }, requestLog: await requests.exists() ? requests.filePath : null, debugLog }
  }

  // Captured API requests for the session `meta` is of (see bin/proxy.mjs), within `range` as read is.
  async requests(meta, range = null) {
    if (!isSafeId(meta.sessionId)) return []
    const own = await this.#requestFile(meta.sessionId, meta.parentSessionId).read(range)
    // No session id to tell whose they are, so every session active at the time lists them
    const span = { start: meta.startedAt, end: meta.lastActivityAt }
    const unattributed = (await new RequestFile(UNATTRIBUTED).read(span)).map(r => ({ ...r, unattributed: true }))
    return [...own, ...unattributed].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  }

  // A branch copies its source's turns but not the requests that sent them: those come from the source, up to the
  // branch point. That part of the source never changes, so the last one read is kept for the branch's live updates.
  #branchSource({ filePath, forkedFrom, forkedAt }) {
    if (!forkedFrom) return { records: [], side: [], compacts: [] }
    const key = `${filePath} ${forkedAt}`
    if (this.#branch?.key !== key) this.#branch = { key, source: this.#readBranchSource(filePath, forkedFrom.sessionId, forkedAt) }
    return this.#branch.source
  }

  // The source's request records (shapes, blobs, requests) and side requests sent up to `at`; its transcript sits beside the branch.
  async #readBranchSource(filePath, sessionId, at) {
    const records = []
    const [{ strips: side, compacts }] = await Promise.all([
      new RequestFile(sessionId).readInstructions({ start: 0, end: at }),
      new SessionFile(path.join(path.dirname(filePath), `${sessionId}.jsonl`)).stream(obj => {
        if (obj.type?.startsWith('api-request')) records.push(obj)
      }),
    ])
    // cut after the last request in time: the shapes and blobs logged past it belong to later ones
    return { records: records.slice(0, records.findLastIndex(o => o.type === 'api-request' && Date.parse(o.timestamp) <= at) + 1), side, compacts }
  }

  // Subagents send the parent's session id, so the proxy logs their requests into the parent's
  // file, tagged x-claude-code-agent-id — route their reads there. The transcript filename is
  // `agent-<id>`; RequestFile normalizes that id against the header's own spelling.
  #requestFile(sessionId, parentSessionId) {
    const agentId = parentSessionId && sessionId.startsWith('agent-') ? sessionId.slice('agent-'.length) : null
    return agentId ? new RequestFile(parentSessionId, { agentId }) : new RequestFile(sessionId)
  }

  // Stat the file, stream every line through a fresh SessionParser, and finalize.
  // `excludeIds` skips message ids already counted in an earlier session.
  async #parse(reader, { range = null, excludeIds = null, stat = null } = {}) {
    if (!stat) stat = await reader.stat()
    if (!stat) return null
    const parser = new SessionParser({
      sessionId: reader.sessionId,
      parentSessionId: reader.parentSessionId,
      filePath: reader.filePath,
      parentFilePath: reader.parentFilePath,
      fileSize: stat.size,
      mtime: stat.mtimeMs,
      range, excludeIds,
      pricing: this.pricing,
    })
    await this.#parses.run(() => reader.stream(obj => parser.feed(obj)))
    const meta = parser.finalize(stat.mtimeMs)
    // The parser keeps the raw cwd as project; grouping it needs disk access, which the parser stays free of
    const [project, avatar, agent, debug = false] = await Promise.all([
      this.projects.resolve(meta.project), this.projects.avatar(meta.project), reader.agentMeta(), debugLogOf(reader)?.exists(),
    ])
    // An unnamed agent goes by its type, as in Claude Code's own agent list
    meta.agentName ??= agent?.name ?? agent?.agentType ?? null
    meta.agentDescription = agent?.description ?? null
    return Object.assign(meta, project, { avatar, debug })
  }
}
