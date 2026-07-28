import { EventEmitter } from 'node:events'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO } from 'date-fns'
import { SessionFile } from '../sessions/SessionFile.js'
import { RequestFile } from '../requests/RequestFile.js'
import { SessionParser, suffixLabels } from '../sessions/SessionParser.js'
import { SessionsScanner } from '../sessions/SessionsScanner.js'
import { MetaCache } from '../sessions/MetaCache.js'
import { Pricing } from './Pricing.js'

// Week-scoped views start on Monday — keep in sync with src/renderer/utils/period.js.
const WEEK = { weekStartsOn: 1 }

export function periodBounds(date, granularity = 'day', tz = undefined) {
  const opts = { in: tz }
  const d = parseISO(date, opts)
  if (granularity === 'week') return { start: +startOfWeek(d, { ...WEEK, ...opts }), end: +endOfWeek(d, { ...WEEK, ...opts }) }
  if (granularity === 'month') return { start: +startOfMonth(d, opts), end: +endOfMonth(d, opts) }
  return { start: +startOfDay(d, opts), end: +endOfDay(d, opts) }
}

function intersectsDay(meta, day) {
  return meta.lastActivityAt >= day.start && meta.startedAt <= day.end
}

// seenMessageIds (one id per message) exists only for dedup here in main — drop it from
// everything leaving the service, it's dead weight over IPC.
function stripInternal({ seenMessageIds, ...meta }) {
  return meta
}

export class SessionsService extends EventEmitter {
  constructor({ root, throttleMs = 100, scanner = null } = {}) {
    super()
    this.scanner = scanner ?? new SessionsScanner(root ? { root } : {})
    this.pricing = new Pricing()
    this.throttleMs = throttleMs
    this.metaCache = new MetaCache()
    this.activeDay = null
    this.scanAbort = null
    this.updateTimer = null
    this.lastUpdateAt = 0
  }

  // Always parses the whole file from 0: the parser's running token totals only stamp
  // correctly from a fresh start, so live updates re-read rather than resume at an offset.
  async readSession(sessionId, date = null, granularity = 'day') {
    const meta = this.metaCache.byId(sessionId)
    if (!meta) return null
    const range = date ? periodBounds(date, granularity) : null
    const reader = new SessionFile(meta.filePath)
    const parser = new SessionParser({ sessionId: reader.sessionId, parentSessionId: reader.parentSessionId, filePath: reader.filePath, mtime: meta.mtime, range })
    const items = []
    await reader.stream(obj => { if (parser.feed(obj)) items.push(obj) })
    items.sort((a, b) => a._ts - b._ts) // .jsonl lines aren't always in timestamp order
    for (const o of items) delete o._ts
    // System prompts and memory files captured by the request proxy, shipped separately from the
    // transcript items; the renderer slots them into the view by timestamp.
    const instructions = await this.#requestFile(reader.sessionId, reader.parentSessionId).readInstructions()
    return { items, instructions }
  }

  // Captured API requests for a session (see bin/proxy.mjs), period-filtered like readSession.
  async readRequests(sessionId, date = null, granularity = 'day') {
    if (!/^[\w-]+$/.test(sessionId)) return [] // the id becomes a filename — same guard as the proxy
    const range = date ? periodBounds(date, granularity) : null
    return this.#requestFile(sessionId, this.metaCache.byId(sessionId)?.parentSessionId).read(range)
  }

  // Subagents send the parent's session id, so the proxy logs their requests into the parent's
  // file, tagged x-claude-code-agent-id — route their reads there. The transcript filename is
  // `agent-<id>` while the header carries the bare <id>.
  #requestFile(sessionId, parentSessionId) {
    const agentId = parentSessionId && sessionId.startsWith('agent-') ? sessionId.slice('agent-'.length) : null
    return agentId ? new RequestFile(parentSessionId, { agentId }) : new RequestFile(sessionId)
  }

  // Scan `period` ({ start, end } epoch ms, optional `key`/`date`; see periodBounds). watch:true (UI) streams 'update' events per dir batch and returns the current cache immediately; watch:false (CLIs/tests) awaits completion and returns the deduped sessions with no emits.
  async scan(period, { watch = false } = {}) {
    const day = period.key ? period : { ...period, key: `${period.start}|${period.end}` }
    this.metaCache.setPeriod(day.key) // new period → drop period-scoped metas (whole-file metas survive)
    this.activeDay = day
    this.scanAbort?.abort() // a superseded scan stops walking instead of racing the new one
    this.scanAbort = new AbortController()
    const fresh = () => this.activeDay?.key === day.key // guard against stale period navigation
    const scan = this.scanner.scan(day, {
      onFile: (filePath, stat) => this._processFile(filePath, day, stat),
      signal: this.scanAbort.signal,
      ...(watch && {
        onBatchDone: () => { if (fresh()) this._scheduleUpdate() },
        onProgress: p => { if (fresh()) this.emit('progress', p) },
      })
    })

    if (watch) scan.catch(console.error) // fire-and-forget; the scanner streams an update per dir batch + a final flush
    else await scan // block until the full scan completes
    return this._dedupedDay(day)
  }

  // IPC/UI entry: build the period from date+granularity and watch it.
  list(date, granularity = 'day') {
    const key = `${granularity}|${date}`
    return this.scan({ ...periodBounds(date, granularity), date, key }, { watch: true })
  }

  start() {
    // wired here, not in the constructor — repricing is for the watched UI mode, not CLI scans
    this.pricing.on('update', () => this._reprice())
    this.scanner.watch({
      onChange: (p, stat) => this._refresh(p, stat),
      onUnlink: p => this._evict(p)
    })
    return this
  }

  stop() {
    this.pricing.removeAllListeners('update')
    this.scanner.stop()
    this.scanAbort?.abort()
    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
      this.updateTimer = null
    }
  }

  // Stat the file, stream every line through a fresh SessionParser, and finalize.
  // `excludeIds` skips message ids already counted in an earlier session.
  async _scanSession(reader, { range = null, excludeIds = null, stat = null } = {}) {
    if (!stat) stat = await reader.stat()
    if (!stat) return null
    const parser = new SessionParser({
      sessionId: reader.sessionId,
      parentSessionId: reader.parentSessionId,
      filePath: reader.filePath,
      fileSize: stat.size,
      mtime: stat.mtimeMs,
      range, excludeIds,
      pricing: this.pricing,
    })
    await reader.stream(obj => parser.feed(obj))
    return parser.finalize(stat.mtimeMs)
  }

  // Resume/fork copies prior message.ids verbatim. Walk earliest-first; if a
  // session's ids overlap one already counted, rescan it with the overlap
  // excluded so it contributes only its NEW messages.
  async _dedupSessions(metas, range) {
    const sorted = [...metas].sort((a, b) => a.startedAt - b.startedAt)
    const globalSeen = new Set()
    const rescans = new Map()
    for (const m of sorted) {
      let overlap = null
      for (const id of m.seenMessageIds || []) {
        if (globalSeen.has(id)) (overlap ||= new Set()).add(id)
        globalSeen.add(id)
      }
      if (overlap) rescans.set(m.sessionId, this._scanSession(new SessionFile(m.filePath), { range, excludeIds: overlap }))
    }
    const sessions = await Promise.all(metas.map(async m => {
      const rescanned = await rescans.get(m.sessionId)
      return stripInternal(rescanned ? { ...m, ...rescanned } : m)
    }))
    // Different project dirs can share a "last two segments" label (pytest tmp dirs) — relabel per snapshot
    const labels = suffixLabels(sessions.map(m => m.project))
    for (const m of sessions) m.projectShort = labels.get(m.project)
    return sessions
  }

  _dedupedDay(day) {
    const metas = [...this.metaCache.values()]
      .filter(m => intersectsDay(m, day))
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    return this._dedupSessions(metas, day)
  }

  _processFile(filePath, day, stat) {
    const parse = range => this._scanSession(new SessionFile(filePath), { range, stat })
    return this.metaCache.resolve(filePath, stat, day, parse)
  }

  async _refresh(filePath, stat) {
    const day = this.activeDay
    if (!day || !stat) return
    const cached = this.metaCache.get(filePath)
    const isChanged = !cached || cached.fileSize !== stat.size || cached.mtime !== stat.mtimeMs
    if (!isChanged) return
    const meta = await this._processFile(filePath, day, stat)
    if (meta && intersectsDay(meta, day)) this._scheduleUpdate()
  }

  _evict(filePath) {
    if (this.metaCache.evict(filePath)) this._scheduleUpdate()
  }

  // Prices changed after metas were parsed (first launch races the LiteLLM refresh) — reparse with the new rates.
  _reprice() {
    if (!this.activeDay) return
    this.metaCache.clear()
    this.scan(this.activeDay, { watch: true }).catch(console.error)
  }

  // Leading+trailing throttle: the first call emits immediately, calls within throttleMs
  // coalesce into one trailing emit — so scans paint fast but bursts cost one update.
  _scheduleUpdate() {
    if (this.updateTimer) return // trailing emit already scheduled
    const emit = async () => {
      this.updateTimer = null
      this.lastUpdateAt = Date.now()
      const day = this.activeDay
      try { if (day) this.emit('update', await this._dedupedDay(day)) } // fire-and-forget — a failed re-scan must not become an unhandled rejection
      catch (err) { console.error('sessions update emit failed:', err) }
    }
    const wait = this.lastUpdateAt + this.throttleMs - Date.now()
    if (wait <= 0) emit()
    else this.updateTimer = setTimeout(emit, wait)
  }
}
