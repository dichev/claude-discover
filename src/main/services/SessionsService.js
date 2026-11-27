import { EventEmitter } from 'node:events'
import { SessionsReader, intersects, periodBounds } from '../sessions/SessionsReader.js'
import { Pricing } from './Pricing.js'

// Every typed prompt is in a meta for a search to read: megabytes over a month, so not in what the window is sent on each update
function stripPrompts({ prompts, ...meta }) {
  return meta
}

// Keeps what the window shows fresh, on top of a SessionsReader: the period it watches (list, then an 'update' on every change to its
// transcripts) and the file opened in it (openFile). What a period or a transcript holds is the reader's to tell.
export class SessionsService extends EventEmitter {
  #opened = null // meta of the transcript opened from a file (File → Open, a drop), read whole, outside any period

  constructor({ root, throttleMs = 100, scanner = null } = {}) {
    super()
    this.pricing = new Pricing()
    this.reader = new SessionsReader({ root, scanner, pricing: this.pricing })
    this.throttleMs = throttleMs
    this.periodMetas = new Map() // filePath -> meta within the watched period (ranged for edge-straddlers)
    this.activeDay = null
    this.scanAbort = null
    this.updateTimer = null
    this.paused = false
    this.lastUpdateAt = 0
    this.updateSeq = 0
    this.emittedSeq = 0
  }

  // Keyed by file path, not session id: Claude Code reuses one id across cwds, writing a
  // separate transcript per project dir.
  async readSession(filePath, date = null, granularity = 'day') {
    const meta = this.#meta(filePath)
    return meta && this.reader.read(meta, date ? periodBounds(date, granularity) : null)
  }

  // Captured API requests for a session (see bin/proxy.mjs), period-filtered like readSession.
  async readRequests(filePath, date = null, granularity = 'day') {
    const meta = this.#meta(filePath)
    return meta ? this.reader.requests(meta, date ? periodBounds(date, granularity) : null) : []
  }

  // Looked up by session, so only avatar paths are readable over IPC
  avatarPath(filePath) {
    return this.#meta(filePath)?.avatar ?? null
  }

  // Shown on its own, so its totals are the whole file's; the window reads it next by its path (readSession, readRequests)
  async openFile(filePath) {
    const meta = await this.reader.wholeMeta(filePath)
    if (!meta.messageCount) throw new Error(`No Claude Code messages in ${filePath}`) // any .jsonl can be picked or dropped here, where the MCP tools read a transcript a listing gave them
    this.#opened = stripPrompts(meta)
    return this.#opened
  }

  // Only what the window is on can be read by its path: a session of the watched period, or the opened file
  #meta(filePath) {
    return this.periodMetas.get(filePath) ?? (this.#opened?.filePath === filePath ? this.#opened : null)
  }

  // Watches `day` (a period with its `key`, `date` and `granularity`): returns what is cached of it immediately
  // and streams 'update' events per dir batch, then on every change to its transcripts
  #watch(day) {
    if (day.key !== this.activeDay?.key) this.periodMetas.clear() // re-entering the same period keeps them
    this.activeDay = day
    this.scanAbort?.abort() // a superseded scan stops walking and drops its queued parses instead of racing the new one
    this.scanAbort = new AbortController()
    const { signal } = this.scanAbort
    const fresh = () => this.activeDay?.key === day.key // guard against stale period navigation
    this.reader.scanner.scan(day, {
      onFile: (filePath, stat) => this._processFile(filePath, day, stat, signal),
      signal,
      onBatchDone: () => { if (fresh()) this._scheduleUpdate() },
      onProgress: p => { if (fresh()) this.emit('progress', p) },
    }).catch(console.error) // fire-and-forget; the scanner streams an update per dir batch + a final flush
    return this._dedupedDay(day)
  }

  // IPC/UI entry: build the period from date+granularity and watch it.
  list(date, granularity = 'day') {
    const key = `${granularity}|${date}`
    return this.#watch({ ...periodBounds(date, granularity), date, granularity, key })
  }

  // Nobody is looking at the period (the window is hidden in the tray), so changes stop being parsed as they land
  pause() {
    this.paused = true
  }

  // Catches up, parsing only the files that changed meanwhile, and sends the period afresh
  resume() {
    if (!this.paused) return
    this.paused = false
    if (this.activeDay) this.#watch(this.activeDay).catch(console.error)
  }

  start() {
    this.pricing.on('update', () => this._reprice())
    this.reader.scanner.watch({
      onChange: (p, stat) => {
        this.emit('activity') // any transcript, not just the watched period's
        this._refresh(p, stat)
      },
      onUnlink: p => this._evict(p)
    })
    return this
  }

  stop() {
    this.pricing.removeAllListeners('update')
    this.reader.scanner.stop()
    this.scanAbort?.abort()
    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
      this.updateTimer = null
    }
  }

  // The watched period's sessions, as the window gets them
  async _dedupedDay(day) {
    return (await this.reader.dedup(this.periodMetas.values(), day)).map(stripPrompts)
  }

  // A file's meta within `day`, kept for the watched period: a scan superseded, or still in flight for a period the window has left, writes none
  async _processFile(filePath, day, stat, signal = null) {
    const meta = await this.reader.meta(filePath, stat, day, signal).catch(err => { if (!signal?.aborted) throw err })
    if (signal?.aborted || day.key !== this.activeDay?.key) return meta
    if (meta) this.periodMetas.set(filePath, meta)
    else this.periodMetas.delete(filePath)
    return meta
  }

  async _refresh(filePath, stat) {
    const day = this.activeDay
    if (!day || !stat || this.paused) return
    const cached = this.periodMetas.get(filePath)
    const isChanged = !cached || cached.fileSize !== stat.size || cached.mtime !== stat.mtimeMs
    if (!isChanged) return
    const meta = await this._processFile(filePath, day, stat)
    if (meta && intersects(meta, day)) this._scheduleUpdate()
  }

  _evict(filePath) {
    this.reader.forget(filePath)
    if (this.periodMetas.delete(filePath)) this._scheduleUpdate()
  }

  // Prices changed after metas were parsed (first launch races the LiteLLM refresh) — reparse with the new rates.
  _reprice() {
    this.reader.clear()
    this.periodMetas.clear()
    if (this.activeDay) this.#watch(this.activeDay).catch(console.error)
  }

  // Leading+trailing throttle: the first call emits immediately, calls within throttleMs
  // coalesce into one trailing emit — so scans paint fast but bursts cost one update.
  // Updates are tagged with their period: one still deduping when the user navigates lands after the switch.
  _scheduleUpdate() {
    if (this.updateTimer) return // trailing emit already scheduled
    const emit = async () => {
      this.updateTimer = null
      this.lastUpdateAt = Date.now()
      const day = this.activeDay
      const seq = ++this.updateSeq
      try {
        if (!day) return
        const sessions = await this._dedupedDay(day)
        // Dedup rescans can finish out of order — never send an older snapshot after a newer one.
        // Checked against the last *sent*, not the last started, or steady writes with slow dedup would starve every emit.
        if (seq < this.emittedSeq) return
        this.emittedSeq = seq
        this.emit('update', { date: day.date, granularity: day.granularity, sessions })
      } catch (err) { console.error('sessions update emit failed:', err) } // fire-and-forget — a failed re-scan must not become an unhandled rejection
    }
    const wait = this.lastUpdateAt + this.throttleMs - Date.now()
    if (wait <= 0) emit()
    else this.updateTimer = setTimeout(emit, wait)
  }
}
