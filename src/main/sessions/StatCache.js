// Watcher-fed cache of file stats — a standalone addon in front of SessionsScanner's
// disk walk; delete this file and the scanner's few statCache lines to remove it.
export class StatCache {
  constructor() {
    this.stats = new Map() // filePath -> stat, filled by the walk, kept fresh by watcher events
    this.complete = false  // set after a full walk with the watcher live — the map then mirrors the disk
  }

  record(filePath, stat) {
    if (stat) this.stats.set(filePath, stat)
  }
  remove(filePath) {
    this.stats.delete(filePath)
  }
  markComplete() {
    this.complete = true
  }
  clear() {
    this.stats.clear()
    this.complete = false
  }

  // In-memory disk walk: one batch over the cached stats, same callbacks as SessionsScanner.scan.
  async scan(inPeriod, { onFile, onBatchDone, onProgress, signal } = {}) {
    const tasks = []
    for (const [filePath, stat] of this.stats) {
      if (signal?.aborted) return
      if (inPeriod(stat)) tasks.push(onFile?.(filePath, stat))
    }
    await Promise.all(tasks)
    if (signal?.aborted) return
    await onBatchDone?.()
    onProgress?.({ done: 1, total: 1, scanning: false })
  }
}
