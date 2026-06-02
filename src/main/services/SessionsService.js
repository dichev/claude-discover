import { EventEmitter } from 'node:events'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO } from 'date-fns'
import { SessionFile } from '../sessions/SessionFile.js'
import { SessionParser } from '../sessions/SessionParser.js'
import { SessionsScanner } from '../sessions/SessionsScanner.js'
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

function filterDay(cache, day) {
  return Array.from(cache.values())
    .filter((m) => intersectsDay(m, day))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

// Splice `extras` into `items` by timestamp; items lacking a timestamp are skipped over.
function mergeByTimestamp(items, extras) {
  for (const x of extras) {
    const ts = Date.parse(x.timestamp)
    const idx = items.findIndex(i => i.timestamp && Date.parse(i.timestamp) > ts)
    if (idx === -1) items.push(x); else items.splice(idx, 0, x)
  }
}

// Stat the file, stream every line through a fresh SessionParser, finalize,
// and stitch the post-stream offset onto the meta. `prev` enables incremental
// reuse; `excludeIds` skips message ids already counted in an earlier session.
export async function scanSession(reader, { pricing, prev = null, range = null, excludeIds = null, stat = null }) {
  if (!stat) stat = await reader.stat()
  if (!stat) return null
  const parser = new SessionParser({
    sessionId: reader.sessionId,
    parentSessionId: reader.parentSessionId,
    filePath: reader.filePath,
    fileSize: stat.size,
    mtime: stat.mtimeMs,
    prev, range, excludeIds, pricing,
  })
  const nextOffset = await reader.streamFrom(parser.startOffset, (obj) => parser.feed(obj))
  const meta = parser.finalize(stat.mtimeMs)
  meta.nextOffset = nextOffset
  return meta
}

// Resume/fork copies prior message.ids verbatim. Walk earliest-first; if a
// session's ids overlap one already counted, rescan it with the overlap
// excluded so it contributes only its NEW messages.
export async function dedupSessions(metas, pricing, range = null) {
  const sorted = [...metas].sort((a, b) => a.startedAt - b.startedAt)
  const globalSeen = new Set()
  const rescans = new Map()
  for (const m of sorted) {
    let overlap = null
    for (const id of m.seenMessageIds || []) {
      if (globalSeen.has(id)) (overlap ||= new Set()).add(id)
      globalSeen.add(id)
    }
    if (overlap) rescans.set(m.sessionId, scanSession(new SessionFile(m.filePath), { range, excludeIds: overlap, pricing }))
  }
  return Promise.all(metas.map(async (m) => {
    const rescanned = await rescans.get(m.sessionId)
    return rescanned ? { ...m, ...rescanned } : m
  }))
}

export class SessionsService extends EventEmitter {
  constructor({ root, debounceMs = 200, scanner = null } = {}) {
    super()
    this.scanner = scanner ?? new SessionsScanner(root ? { root } : {})
    this.pricing = new Pricing()
    this.debounceMs = debounceMs
    this.cache = new Map()
    this.byId = new Map()
    this.activeDay = null
    this.updateTimer = null
  }

  async readSession(sessionId, offset = 0, date = null, granularity = 'day') {
    const meta = this.byId.get(sessionId)
    if (!meta) return null
    const range = date ? periodBounds(date, granularity) : null
    const reader = new SessionFile(meta.filePath)
    const parser = new SessionParser({ sessionId: reader.sessionId, parentSessionId: reader.parentSessionId, filePath: reader.filePath, mtime: meta.mtime, range })
    const items = []
    const nextOffset = await reader.streamFrom(offset, (obj) => { if (parser.feed(obj)) items.push(obj) })
    for (const o of items) delete o._ts
    if (offset === 0) { // Only on the first read for this session; mid-session instruction loads become visible on the next session re-open to keep it simple
      mergeByTimestamp(items, await reader.readContext())
    }
    return { meta, items, nextOffset }
  }

  // Scan `period` ({ start, end } epoch ms, optional `key`/`date`; see periodBounds). watch:true (UI) streams 'update' events per dir batch and returns the current cache immediately; watch:false (CLIs/tests) awaits completion and returns the deduped sessions with no emits.
  async scan(period, { watch = false } = {}) {
    const day = period.key ? period : { ...period, key: `${period.start}|${period.end}` }
    if (this.activeDay?.key !== day.key) { // new period → drop cached metas (re-scan of the same period keeps its cache)
      this.cache.clear()
      this.byId.clear()
    }
    this.activeDay = day
    const onFile = (filePath, stat) => this._processFile(filePath, day, stat)
    if (watch) {
      // fire-and-forget; scanner streams an update per dir batch + a final flush
      this.scanner.scan(day, { onFile, onBatchDone: async () => {
        if (this.activeDay?.key !== day.key) return // guard against stale period navigation
        this.emit('update', await this._dedupedDay(day))
      } }).catch(console.error)
      return this._dedupedDay(day)
    }
    else {
      await this.scanner.scan(day, { onFile }) // block until the full scan completes
      return this._dedupedDay(day)
    }
  }

  // IPC/UI entry: build the period from date+granularity and watch it.
  list(date, granularity = 'day') {
    const key = `${granularity}|${date}`
    return this.scan({ ...periodBounds(date, granularity), date, key }, { watch: true })
  }

  start() {
    this.scanner.watch({
      onChange: (p, stat) => this._refresh(p, stat),
      onUnlink: (p) => this._evict(p)
    })
    return this
  }

  stop() {
    this.scanner.stop()
    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
      this.updateTimer = null
    }
  }

  _dedupedDay(day) {
    return dedupSessions(filterDay(this.cache, day), this.pricing, day)
  }

  async _processFile(filePath, day, stat) {
    const cached = this.cache.get(filePath)
    const meta = await scanSession(new SessionFile(filePath), { prev: cached, range: day, stat, pricing: this.pricing })
    if (!meta) return null
    this.cache.set(filePath, meta)
    this.byId.set(meta.sessionId, meta)
    return meta
  }

  async _refresh(filePath, stat) {
    const day = this.activeDay
    if (!day || !stat) return
    const cached = this.cache.get(filePath)
    const isChanged = !cached || cached.fileSize !== stat.size || cached.mtime !== stat.mtimeMs
    if (!isChanged) return
    const meta = await this._processFile(filePath, day, stat)
    if (meta && intersectsDay(meta, day)) this._scheduleUpdate()
  }

  _evict(filePath) {
    const cached = this.cache.get(filePath)
    if (this.cache.delete(filePath)) {
      if (cached) this.byId.delete(cached.sessionId)
      this._scheduleUpdate()
    }
  }

  _scheduleUpdate() {
    if (this.updateTimer) return
    this.updateTimer = setTimeout(async () => {
      this.updateTimer = null
      const day = this.activeDay
      if (!day) return
      this.emit('update', await this._dedupedDay(day))
    }, this.debounceMs)
  }
}
