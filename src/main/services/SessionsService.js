import { EventEmitter } from 'node:events'
import { startOfDay, endOfDay, parseISO } from 'date-fns'
import { SessionFile } from '../sessions/SessionFile.js'
import { SessionParser } from '../sessions/SessionParser.js'
import { SessionsScanner } from '../sessions/SessionsScanner.js'
import { Pricing } from './Pricing.js'

function dayBounds(date) {
  const d = parseISO(date)
  return { start: +startOfDay(d), end: +endOfDay(d) }
}

function intersectsDay(meta, day) {
  return meta.lastActivityAt >= day.start && meta.startedAt <= day.end
}

function filterDay(cache, day) {
  return Array.from(cache.values())
    .filter((m) => intersectsDay(m, day))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
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

  async readLogFile(filePath) {
    const resolved = this.scanner.resolveWithinRoot(filePath)
    if (!resolved) return { ok: false, error: 'Path outside projects directory' }
    const text = await new SessionFile(resolved).readText()
    return { ok: true, text }
  }

  async readSession(sessionId, offset = 0, date = null) {
    const meta = this.byId.get(sessionId)
    if (!meta) return null
    const range = date ? dayBounds(date) : null
    const reader = new SessionFile(meta.filePath)
    const parser = new SessionParser({ sessionId: reader.sessionId, parentSessionId: reader.parentSessionId, filePath: reader.filePath, range })
    const items = []
    const nextOffset = await reader.streamFrom(offset, (obj) => { if (parser.feed(obj)) items.push(obj) })
    return { meta, items, nextOffset }
  }

  async list(date) {
    const day = { ...dayBounds(date), date }
    if (this.activeDay?.date !== date) {
      this.cache.clear()
      this.byId.clear()
    }
    this.activeDay = day
    // Called after each dir batch and once more when the full scan completes.
    const emit = async () => {
      if (this.activeDay?.date !== date) return // guard against stale day navigation
      this.emit('update', await this._dedupedDay(day))
    }
    const onFile = (filePath, stat) => this._processFile(filePath, day, stat)
    this.scanner.scan(day, { onFile, onBatchDone: emit }).then(emit).catch(console.error) // fire-and-forget; streams updates as dirs complete
    return this._dedupedDay(day) // return current cache immediately (empty on first visit)
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
