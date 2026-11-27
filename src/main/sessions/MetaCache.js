// Whole-file session metas by path, kept while the file's stat stands (transcripts are append-only).
// Pure policy over an injected `parse(range)` — never touches disk itself.
import { unread } from './SessionFile.js'

export class MetaCache {
  #files = new Map() // filePath -> { size, mtimeMs, meta }, the meta a promise from when it starts parsing, for the scans running beside to share

  // Meta for one file within `period` ({ start, end }), or null when it has no activity there.
  // `parse(range)` runs only on cache misses (range = null → whole file) and for files straddling a period edge.
  async resolve(filePath, stat, period, parse, signal = null) {
    let e = this.#files.get(filePath)
    if (!e || e.size !== stat.size || e.mtimeMs !== stat.mtimeMs) {
      e = { size: stat.size, mtimeMs: stat.mtimeMs, meta: parse(null) }
      this.#files.set(filePath, e)
    }
    // Forgotten either way: a file that failed to read is left out of this scan, for the next to read again,
    // and a parse its scan dropped before it ran is parsed anew for a scan still wanting it
    let m
    try {
      m = await e.meta
    } catch (err) {
      if (this.#files.get(filePath) === e) this.#files.delete(filePath)
      if (err?.name !== 'AbortError') return unread(err)
      return signal?.aborted ? null : this.resolve(filePath, stat, period, parse, signal)
    }
    if (!m || m.lastActivityAt < period.start || m.startedAt > period.end) return null
    if (m.startedAt >= period.start && m.lastActivityAt <= period.end) return m
    try {
      return await parse(period)
    } catch (err) {
      return unread(err)
    }
  }

  // Forget every meta, e.g. when a pricing change invalidates them all.
  clear() {
    this.#files.clear()
  }

  // Forget a deleted file.
  evict(filePath) {
    this.#files.delete(filePath)
  }
}
