import fsp from 'node:fs/promises'
import path from 'node:path'
import chokidar from 'chokidar'
import {CLAUDE_PROJECTS_DIR} from '../paths.js'
import { StatCache } from './StatCache.js'

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

  // Every .jsonl under `dir`, at any depth — subagent transcripts live arbitrarily deep
  // (e.g. <session>/subagents/workflows/<wf>/agent-*.jsonl). The walk can't prune subtrees
  // by directory mtime, because on Windows appending to an existing transcript does NOT
  // bump its parent dir's mtime.
  async _listJsonl(dir) {
    const entries = await fsp.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])
    return entries.filter(e => e.isFile() && isJsonl(e.name)).map(e => path.join(e.parentPath, e.name))
  }

  // Append-only transcripts span [birthtime, mtime], so files outside the period are skipped
  // Note birthtime is trusted only when well older than mtime, since copies/restores (git checkout, scp, zip) get a fresh birthtime over old content.
  _inPeriod(stat, day) {
    if (stat.mtimeMs < day.start) return false
    return !(stat.birthtimeMs > day.end && stat.birthtimeMs + 2000 <= stat.mtimeMs)
  }

  // Walks each project subtree in full. For each .jsonl whose stat passes _inPeriod
  // (file mtime IS updated on append, unlike dir mtime), calls onFile(filePath, stat).
  // After each project's files are processed, calls onBatchDone() if any onFile returned
  // truthy — lets callers flush UI updates incrementally. An aborted `signal` (a superseded
  // scan) stops the walk: no further stats, onFile calls or emits. Once a walk has completed
  // with the watcher live, the StatCache mirrors the disk and serves later scans in memory.
  async scan(day, { onFile, onBatchDone, onProgress, signal } = {}) {
    if (this.statCache.complete && this.watcher) return this.statCache.scan(stat => this._inPeriod(stat, day), { onFile, onBatchDone, onProgress, signal })
    const projects = await this._listDirs(this.root)
    let done = 0
    const progress = () => onProgress?.({ done, total: projects.length, scanning: done < projects.length }) // project count is the known denominator for the UI progress bar
    progress()
    await Promise.all(projects.map(async projDir => {
      if (signal?.aborted) return
      const results = await Promise.all((await this._listJsonl(projDir)).map(async fp => {
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

  watch({ onChange, onUnlink } = {}) {
    const isUNC = this.root.startsWith('\\\\') || this.root.startsWith('//') // native fs.watch fails on UNC (e.g. \\wsl.localhost\...)
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      alwaysStat: true,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      ignored: (p, stats) => !!stats?.isFile() && !isJsonl(p),
      ...(isUNC && { usePolling: true, interval: 1000 }),
    })
    const changed = (p, stat) => {
      if (!isJsonl(p)) return
      this.statCache.record(p, stat)
      onChange?.(p, stat)
    }
    const removed = p => {
      if (!isJsonl(p)) return
      this.statCache.remove(p)
      onUnlink?.(p)
    }
    this.watcher.on('add', changed)
    this.watcher.on('change', changed)
    this.watcher.on('unlink', removed)
  }

  stop() {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
      this.statCache.clear() // events are missed while stopped (e.g. across suspend/resume)
    }
  }
}
