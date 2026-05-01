import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import chokidar from 'chokidar'
import { startOfDay, endOfDay, parseISO } from 'date-fns'
import { SessionReader, loadSessionNames } from './SessionReader.js'
import { scanSession, dedupAcrossSessions } from './SessionParser.js'

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects')

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
    scanSession(new SessionReader(m.filePath), { range, excludeIds })
  )
}

export class SessionsService {
  constructor({ root = PROJECTS_ROOT, onUpdate = () => {}, debounceMs = 200 } = {}) {
    this.root = root
    this.onUpdate = onUpdate
    this.debounceMs = debounceMs
    this.cache = new Map()
    this.byId = new Map()
    this.activeDay = null
    this.updateTimer = null
    this.watcher = null
  }

  async readSession(sessionId, offset = 0, date = null) {
    const meta = this.byId.get(sessionId)
    if (!meta) return null
    const range = date ? dayBounds(date) : null
    const { items, nextOffset } = await new SessionReader(meta.filePath).readFrom(offset, range)
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
    this._scanDay(day, emit).then(emit).catch(console.error) // fire-and-forget; streams updates as dirs complete
    return dedupSessions(filterDay(this.cache, day, names), day) // return current cache immediately (empty on first visit)
  }

  async start() {
    this._startWatcher()
    return this
  }

  stop() {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
      this.updateTimer = null
    }
  }

  async _processFile(filePath, day, { skipBeforeDay = false } = {}) {
    const reader = new SessionReader(filePath)
    const stat = await reader.stat()
    if (!stat) return null
    if (skipBeforeDay && stat.mtimeMs < day.start) return null
    const cached = this.cache.get(filePath)
    if (isUnchanged(cached, stat)) return null
    const meta = await scanSession(reader, { prev: cached, range: day, stat })
    if (!meta) return null
    this.cache.set(filePath, meta)
    this.byId.set(meta.sessionId, meta)
    return meta
  }

  async _refresh(filePath) {
    const day = this.activeDay
    if (!day) return
    const meta = await this._processFile(filePath, day)
    if (meta && intersectsDay(meta, day)) this._scheduleUpdate()
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

  async _scanDay(day, onBatch = null) {
    let dirs
    try {
      dirs = await fsp.readdir(this.root, { withFileTypes: true })
    } catch (err) {
      console.error('day scan failed', err)
      return
    }
    await Promise.all(
      dirs.filter((e) => e.isDirectory()).map(async (e) => {
        const dirPath = path.join(e.parentPath, e.name)
        const stat = await fsp.stat(dirPath).catch(() => null)
        if (!stat || stat.mtimeMs < day.start) return
        const files = await fsp.readdir(dirPath, { withFileTypes: true }).catch(() => [])
        const filePaths = files
          .filter((f) => f.isFile() && f.name.endsWith('.jsonl'))
          .map((f) => path.join(f.parentPath, f.name))
        const results = await Promise.all(filePaths.map((p) => this._processFile(p, day, { skipBeforeDay: true })))
        if (onBatch && results.some(Boolean)) await onBatch() // emit after each dir so the UI updates incrementally
      })
    )
  }

  _startWatcher() {
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      ignored: (p, stats) => !!stats?.isFile() && !p.endsWith('.jsonl')
    })
    const isJsonl = (p) => p.endsWith('.jsonl')
    this.watcher.on('add', (p) => isJsonl(p) && this._refresh(p))
    this.watcher.on('change', (p) => isJsonl(p) && this._refresh(p))
    this.watcher.on('unlink', (p) => {
      if (!isJsonl(p)) return
      const cached = this.cache.get(p)
      if (this.cache.delete(p)) {
        if (cached) this.byId.delete(cached.sessionId)
        this._scheduleUpdate()
      }
    })
  }
}
