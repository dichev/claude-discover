// Session-meta cache consumed by SessionsService, pure policy over an injected
// `parse(range)` — never touches disk itself.
export class MetaCache {
  constructor() {
    this.periodKey = null
    this.files = new Map() // filePath -> { size, mtimeMs, meta } — whole-file metas, survive period changes (transcripts are append-only)
    this.periodMetas = new Map() // filePath -> meta within the active period (ranged for edge-straddlers)
  }

  // New period → drop the period layer; re-entering the same period keeps it.
  setPeriod(key) {
    if (this.periodKey === key) return
    this.periodKey = key
    this.periodMetas.clear()
  }

  get(filePath) { return this.periodMetas.get(filePath) }
  byId(sessionId) { return [...this.periodMetas.values()].find(m => m.sessionId === sessionId) }
  values() { return this.periodMetas.values() }

  // Meta for one file within `day` ({ start, end, key }), or null when it has no activity there.
  // `parse(range)` runs only on cache misses (range = null → whole file) and for files straddling a period edge.
  async resolve(filePath, stat, day, parse) {
    let e = this.files.get(filePath)
    if (!e || e.size !== stat.size || e.mtimeMs !== stat.mtimeMs) {
      e = { size: stat.size, mtimeMs: stat.mtimeMs, meta: await parse(null) }
      this.files.set(filePath, e)
    }
    let m = e.meta
    if (m && (m.lastActivityAt < day.start || m.startedAt > day.end)) m = null
    else if (m && !(m.startedAt >= day.start && m.lastActivityAt <= day.end)) m = await parse(day)
    if (day.key !== this.periodKey) return m // stale in-flight scan — don't write another period's meta into the layer
    if (!m) { this.periodMetas.delete(filePath); return null }
    this.periodMetas.set(filePath, m)
    return m
  }

  // Drop both layers, e.g. when a pricing change invalidates every meta.
  clear() {
    this.files.clear()
    this.periodMetas.clear()
  }

  // Forget a deleted file. True if the period layer shrank.
  evict(filePath) {
    this.files.delete(filePath)
    return this.periodMetas.delete(filePath)
  }
}
