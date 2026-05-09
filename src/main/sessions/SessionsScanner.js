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
    return entries.filter(e => !!e.isDirectory()).map(e => path.join(e.parentPath, e.name))
  }

  // Walks projects + their subagents/ dirs. For each .jsonl whose mtime >= day.start,
  // calls onFile(filePath, stat). After each directory's files are processed, calls
  // onBatchDone() if any onFile returned truthy — lets callers flush UI updates incrementally.
  async scan(day, { onFile, onBatchDone } = {}) {
    const projects = await this._listDirs(this.root)
    const subagents = (await Promise.all(projects.map(d => this._listDirs(d)))).flat().map(d => path.join(d, 'subagents'))
    await Promise.all(
      [...projects, ...subagents].map(async (dirPath) => {
        const dirStat = await fsp.stat(dirPath).catch(() => null)
        if (!dirStat || dirStat.mtimeMs < day.start) return // skip if there are no sessions on or after the current day
        const entries = await fsp.readdir(dirPath, { withFileTypes: true }).catch(() => [])
        const filePaths = entries
          .filter((f) => f.isFile() && f.name.endsWith('.jsonl'))
          .map((f) => path.join(f.parentPath, f.name))
        const candidates = await Promise.all(filePaths.map(async (fp) => {
          const stat = await fsp.stat(fp).catch(() => null)
          return stat && stat.mtimeMs >= day.start ? { filePath: fp, stat } : null
        }))
        const valid = candidates.filter(Boolean)
        const results = onFile ? await Promise.all(valid.map(({ filePath, stat }) => onFile(filePath, stat))) : []
        if (onBatchDone && results.some(Boolean)) await onBatchDone()
      })
    )
  }

  watch({ onChange, onUnlink } = {}) {
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      alwaysStat: true,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      ignored: (p, stats) => !!stats?.isFile() && !isJsonl(p)
    })
    this.watcher.on('add', (p, stat) => isJsonl(p) && onChange?.(p, stat))
    this.watcher.on('change', (p, stat) => isJsonl(p) && onChange?.(p, stat))
    this.watcher.on('unlink', (p) => isJsonl(p) && onUnlink?.(p))
  }

  resolveWithinRoot(filePath) {
    const resolved = path.resolve(filePath || '')
    return resolved.startsWith(this.root + path.sep) ? resolved : null
  }

  stop() {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
}