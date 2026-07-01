import fsp from 'node:fs/promises'
import path from 'node:path'
import chokidar from 'chokidar'
import {CLAUDE_PROJECTS_DIR} from '../paths.js'

const isJsonl = (p) => p.endsWith('.jsonl')

export class SessionsScanner {
  constructor({ root = CLAUDE_PROJECTS_DIR } = {}) {
    this.root = root
    this.watcher = null
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

  // Walks each project subtree in full. For each .jsonl whose own mtime >= day.start
  // (file mtime IS updated on append, unlike dir mtime), calls onFile(filePath, stat).
  // After each project's files are processed, calls onBatchDone() if any onFile returned
  // truthy — lets callers flush UI updates incrementally.
  async scan(day, { onFile, onBatchDone, onProgress } = {}) {
    const projects = await this._listDirs(this.root)
    let done = 0
    const progress = () => onProgress?.({ done, total: projects.length, scanning: done < projects.length }) // project count is the known denominator for the UI progress bar
    progress()
    await Promise.all(projects.map(async projDir => {
      const results = await Promise.all((await this._listJsonl(projDir)).map(async fp => {
        const stat = await fsp.stat(fp).catch(() => null)
        return stat && stat.mtimeMs >= day.start ? onFile?.(fp, stat) : null
      }))
      if (onBatchDone && results.some(Boolean)) await onBatchDone()
      done++
      progress()
    }))
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
    this.watcher.on('add', (p, stat) => isJsonl(p) && onChange?.(p, stat))
    this.watcher.on('change', (p, stat) => isJsonl(p) && onChange?.(p, stat))
    this.watcher.on('unlink', (p) => isJsonl(p) && onUnlink?.(p))
  }

  stop() {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
}