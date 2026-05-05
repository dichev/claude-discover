import { startOfDay, endOfDay, parseISO } from 'date-fns'
import { SessionFile, loadSessionNames } from '../sessions/SessionFile.js'
import { scanSession, dedupAcrossSessions } from '../sessions/SessionParser.js'
import { SessionsScanner } from '../sessions/SessionsScanner.js'

function dayBounds(date) {
  const d = parseISO(date)
  return { start: +startOfDay(d), end: +endOfDay(d) }
}

function intersectsDay(meta, day) {
  return meta.lastActivityAt >= day.start && meta.startedAt <= day.end
}

function filterDay(cache, day, names) {
  return Array.from(cache.values())
    .filter((m) => intersectsDay(m, day))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .map((m) => names?.has(m.sessionId) ? { ...m, name: names.get(m.sessionId) } : m)
}

function isUnchanged(cached, stat) {
  return cached && cached.fileSize === stat.size && cached.mtime === stat.mtimeMs
}

export async function dedupSessions(metas, range = null) {
  return dedupAcrossSessions(metas, (m, excludeIds) =>
    scanSession(new SessionFile(m.filePath), { range, excludeIds })
  )
}

export class SessionsService {
  constructor({ root, onUpdate = () => {}, debounceMs = 200, scanner = null } = {}) {
    this.scanner = scanner ?? new SessionsScanner(root ? { root } : {})
    this.onUpdate = onUpdate
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
    const { items, nextOffset } = await new SessionFile(meta.filePath).readFrom(offset, range)
    return { meta, items, nextOffset }
  }

  async list(date) {
    const day = { ...dayBounds(date), date }
    if (this.activeDay?.date !== date) {
      this.cache.clear()
      this.byId.clear()
    }
    this.activeDay = day
    const names = await loadSessionNames()
    // emit is called after each dir batch and once more when the full scan completes
    const emit = async () => {
      if (this.activeDay?.date !== date) return // guard against stale day navigation
      this.onUpdate(await dedupSessions(filterDay(this.cache, day, names), day))
    }
    const onFile = (filePath, stat) => this._processFile(filePath, day, stat)
    this.scanner.scan(day, { onFile, onBatchDone: emit }).then(emit).catch(console.error) // fire-and-forget; streams updates as dirs complete
    return dedupSessions(filterDay(this.cache, day, names), day) // return current cache immediately (empty on first visit)
  }

  async start() {
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

  _processFile(filePath, day, stat) {
    if (!stat) return null
    const cached = this.cache.get(filePath)
    if (isUnchanged(cached, stat)) return null
    return scanSession(new SessionFile(filePath), { prev: cached, range: day, stat }).then((meta) => {
      if (!meta) return null
      this.cache.set(filePath, meta)
      this.byId.set(meta.sessionId, meta)
      return meta
    })
  }

  async _refresh(filePath, stat) {
    const day = this.activeDay
    if (!day) return
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
      const names = await loadSessionNames()
      this.onUpdate(await dedupSessions(filterDay(this.cache, day, names), day))
    }, this.debounceMs)
  }
}
