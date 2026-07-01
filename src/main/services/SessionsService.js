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
    const nextOffset = await reader.streamFrom(offset, obj => { if (parser.feed(obj)) items.push(obj) })
    // Context records only on the first read (mid-session instruction loads show up on the next
    // re-open), stamped with _ts so they sort alongside the transcript items.
    if (offset === 0) {
      for (const x of await reader.readContext()) items.push(Object.assign(x, { _ts: Date.parse(x.timestamp) }))
    }
    items.sort((a, b) => a._ts - b._ts) // .jsonl lines aren't always in timestamp order
    for (const o of items) delete o._ts
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
    const fresh = () => this.activeDay?.key === day.key // guard against stale period navigation
    const scan = this.scanner.scan(day, {
      onFile: (filePath, stat) => this._processFile(filePath, day, stat),
      ...(watch && {
        onBatchDone: async () => { if (fresh()) this.emit('update', await this._dedupedDay(day)) },
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
    this.scanner.watch({
      onChange: (p, stat) => this._refresh(p, stat),
      onUnlink: p => this._evict(p)
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
    await reader.streamFrom(0, obj => parser.feed(obj))
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
    return Promise.all(metas.map(async m => {
      const rescanned = await rescans.get(m.sessionId)
      return rescanned ? { ...m, ...rescanned } : m
    }))
  }

  _dedupedDay(day) {
    const metas = [...this.cache.values()]
      .filter(m => intersectsDay(m, day))
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    return this._dedupSessions(metas, day)
  }

  async _processFile(filePath, day, stat) {
    const meta = await this._scanSession(new SessionFile(filePath), { range: day, stat })
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
