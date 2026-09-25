import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {CLAUDE_PROJECTS_DIR} from '../paths.js'
import { StatCache } from './StatCache.js'
import { FileWatcher, listFiles } from './utils/FileWatcher.js'

const isJsonl = (p) => p.endsWith('.jsonl')

export class SessionsScanner {
  constructor({ root = CLAUDE_PROJECTS_DIR } = {}) {
    this.root = root
    this.watcher = null
    this.statCache = new StatCache() // lets warm scans skip the readdir+stat sweep (the bottleneck on remote dirs)
  }

  async _listDirs(p) {
    const entries = await fsp.readdir(p, { withFileTypes: true }).catch(() => [])
    return entries.filter(e => e.isDirectory()).map(e => path.join(e.parentPath, e.name))
  }

  // Append-only transcripts span [birthtime, mtime], so files outside the period are skipped
  // Note birthtime is trusted only when well older than mtime, since copies/restores (git checkout, scp, zip) get a fresh birthtime over old content.
  _inPeriod(stat, day) {
    if (stat.mtimeMs < day.start) return false
    return !(stat.birthtimeMs > day.end && stat.birthtimeMs + 2000 <= stat.mtimeMs)
  }

  // Calls onFile(filePath, stat) for every .jsonl passing _inPeriod, then onBatchDone() per project
  // if any onFile returned truthy — so callers can flush UI updates incrementally. An aborted
  // `signal` (a superseded scan) stops everything; once complete with the watcher live, the
  // StatCache mirrors disk and serves later scans in memory.
  async scan(day, opts = {}) {
    if (this.statCache.complete) {
      return this.statCache.scan(stat => this._inPeriod(stat, day), opts)
    }
    return this._walk(day, opts)
  }

  async _walk(day, { onFile, onBatchDone, onProgress, signal } = {}) {
    const projects = await this._listDirs(this.root)
    let done = 0
    const progress = () => onProgress?.({ done, total: projects.length, scanning: done < projects.length }) // project count is the known denominator for the UI progress bar
    progress()
    await Promise.all(projects.map(async projDir => {
      if (signal?.aborted) return
      // Every .jsonl at any depth (subagent transcripts nest); no pruning by dir mtime, which Windows doesn't bump on append
      const files = await listFiles(projDir, isJsonl).catch(() => [])
      const results = await Promise.all(files.map(async fp => {
        const stat = signal?.aborted ? null : await fsp.stat(fp).catch(() => null)
        this.statCache.record(fp, stat)
        return stat && this._inPeriod(stat, day) && !signal?.aborted ? onFile?.(fp, stat) : null
      }))
      if (signal?.aborted) return
      if (onBatchDone && results.some(Boolean)) await onBatchDone()
      done++
      progress()
    }))
    if (signal?.aborted) return // partial walk — don't mark the cache complete
    if (this.watcher) this.statCache.markComplete()
    if (onBatchDone) await onBatchDone() // Callers get a final flush over the fully-scanned state even for empty periods (where no per-project batch fired).
    progress() // terminal emit: covers total===0 and guarantees the bar clears
  }

  // Starts before the first walk, so that walk already completes the StatCache
  watch({ onChange, onUnlink }) {
    try { fs.mkdirSync(this.root, { recursive: true }) } catch {} // Claude Code creates it lazily; fs.watch needs it now
    this.watcher = new FileWatcher(this.root, {
      filter: isJsonl,
      onChange: (p, stat) => {
        this.statCache.record(p, stat)
        onChange(p, stat)
      },
      onUnlink: p => {
        this.statCache.remove(p)
        onUnlink(p)
      },
      onDrop: () => this.statCache.clear(),
      baseline: () => this.statCache.complete ? this.statCache.stats : null, // null until a full walk exists to diff against
    })
  }

  stop() {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
      this.statCache.clear() // events are missed while stopped
    }
  }
}
