import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

// Every file under `dir` passing `filter`, at any depth; rejects if `dir` can't be read
export async function listFiles(dir, filter) {
  const entries = await fsp.readdir(dir, { recursive: true, withFileTypes: true })
  return entries.filter(e => e.isFile() && filter(e.name)).map(e => path.join(e.parentPath, e.name))
}

// Watches a tree with OS events, falling back to interval checks where fs.watch can't (or stops being able to)
export class FileWatcher {
  #root
  #opts
  #watcher = null
  #closed = false

  constructor(root, opts) {
    this.#root = root
    this.#opts = opts
    try {
      this.#watcher = new EventFileWatcher(root, { ...opts, onFail: err => this.#fallBack(err) })
    } catch (err) {
      this.#fallBack(err) // e.g. \\wsl.localhost\... (EISDIR)
    }
  }

  get mode() { return this.#watcher instanceof IntervalFileWatcher ? 'interval' : 'event' }

  // Its first diff against the baseline also catches whatever changed while events were down
  #fallBack(err) {
    if (this.#closed) return
    console.warn('[watch] checking on an interval instead:', err.message)
    this.#watcher = new IntervalFileWatcher(this.#root, this.#opts)
  }

  close() {
    this.#closed = true
    this.#watcher?.close()
  }
}

// One recursive fs.watch for the whole tree — chokidar's handle per file stalled startup ~20s on a cold disk
export class EventFileWatcher {
  #opts
  #handle = null
  #timers = new Map() // filePath -> pending settle timer
  #closed = false

  // Throws if the OS refuses the watch, e.g. on \\wsl.localhost\...
  constructor(root, opts) {
    this.#opts = { settleMs: 100, ...opts }
    this.#handle = fs.watch(root, { recursive: true }, (_type, name) => {
      if (!name) return this.#opts.onDrop() // @windows no name = buffer overflow, events were lost
      if (this.#opts.filter(name)) this.#settle(path.join(root, name))
    })
    this.#handle.on('error', err => { // Node has already closed the handle
      this.close()
      this.#opts.onFail(err)
    })
  }

  // Events carry no stat or kind, so stat each path once its writes settle
  #settle(filePath) {
    const { onChange, onUnlink, settleMs } = this.#opts
    clearTimeout(this.#timers.get(filePath))
    this.#timers.set(filePath, setTimeout(async () => {
      this.#timers.delete(filePath)
      const stat = await fsp.stat(filePath).catch(() => null)
      if (this.#closed) return
      if (!stat) onUnlink(filePath)
      else if (stat.isFile()) onChange(filePath, stat)
    }, settleMs))
  }

  close() {
    this.#closed = true
    for (const timer of this.#timers.values()) {
      clearTimeout(timer)
    }
    this.#timers.clear()
    this.#handle?.close()
  }
}

// Re-lists the tree every intervalMs and diffs it against baseline() — the caller's last known stats (null skips a check)
export class IntervalFileWatcher {
  #root
  #opts
  #timer = null
  #checks = 0
  #closed = false

  // Stats on a share are the bulk of a check, so each one stats only new files and those written within hotMs;
  // every sweepEvery-th check stats them all, catching an idle transcript that grows again (e.g. a resumed session)
  constructor(root, opts) {
    this.#root = root
    this.#opts = { intervalMs: 2000, hotMs: 10 * 60_000, sweepEvery: 30, ...opts }
    this.#schedule()
  }

  // Timed from the end of the last check, so a slow share can't pile them up
  #schedule() {
    this.#timer = setTimeout(() => this.#check().finally(() => this.#closed || this.#schedule()), this.#opts.intervalMs)
  }

  async #check() {
    const { filter, onChange, onUnlink, baseline } = this.#opts
    const known = baseline()
    if (!known) return
    const files = await listFiles(this.#root, filter).catch(() => null)
    if (!files) return // share unreachable — don't report every file as deleted
    const sweep = ++this.#checks % this.#opts.sweepEvery === 0
    const now = Date.now()
    await Promise.all(files.map(async fp => {
      const old = known.get(fp)
      if (!sweep && old && now - old.mtimeMs >= this.#opts.hotMs) return
      const stat = await fsp.stat(fp).catch(() => null)
      if (stat && !this.#closed && (!old || old.size !== stat.size || old.mtimeMs !== stat.mtimeMs)) onChange(fp, stat)
    }))
    if (this.#closed) return
    const listed = new Set(files)
    for (const fp of known.keys()) { // onUnlink may delete from known — safe while iterating a Map
      if (!listed.has(fp)) onUnlink(fp)
    }
  }

  close() {
    this.#closed = true
    clearTimeout(this.#timer)
  }
}
