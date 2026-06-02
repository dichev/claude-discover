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

  // Recursively collect every .jsonl under `dir` into `out`. Subagent transcripts live
  // arbitrarily deep (e.g. <session>/subagents/workflows/<wf>/agent-*.jsonl), so we can't
  // assume a fixed depth — and we can't prune subtrees by directory mtime, because on
  // Windows appending to an existing transcript does NOT bump its parent dir's mtime.
  async _collectJsonl(dir, out) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.map(async (e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await this._collectJsonl(full, out)
      else if (e.isFile() && isJsonl(e.name)) out.push(full)
    }))
  }

  // Walks each project subtree in full. For each .jsonl whose own mtime >= day.start
  // (file mtime IS updated on append, unlike dir mtime), calls onFile(filePath, stat).
  // After each project's files are processed, calls onBatchDone() if any onFile returned
  // truthy — lets callers flush UI updates incrementally.
  async scan(day, { onFile, onBatchDone } = {}) {
    const projects = await this._listDirs(this.root)
    await Promise.all(
      projects.map(async (projDir) => {
        const filePaths = []
        await this._collectJsonl(projDir, filePaths)
        const candidates = await Promise.all(filePaths.map(async (fp) => {
          const stat = await fsp.stat(fp).catch(() => null)
          return stat && stat.mtimeMs >= day.start ? { filePath: fp, stat } : null
        }))
        const valid = candidates.filter(Boolean)
        const results = onFile ? await Promise.all(valid.map(({ filePath, stat }) => onFile(filePath, stat))) : []
        if (onBatchDone && results.some(Boolean)) await onBatchDone()
      })
    )
    if (onBatchDone) await onBatchDone() // Callers get a final flush over the fully-scanned state even for empty periods (where no per-project batch fired).
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