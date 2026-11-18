import fsp from 'node:fs/promises'
import path from 'node:path'
import { isSameDay, set } from 'date-fns'
import writeFileAtomic from 'write-file-atomic'
import { DATA_DIR } from '../paths.js'
import { periodBounds } from './SessionsService.js'

const EVERY     = 60 * 60_000
const DAY_CLOSE = { hours: 23, minutes: 55 } // one more scan before midnight, so the day's snapshot covers its evening

// What /usage says is using the plan's limits: Claude Code's scan of the last 7 days of transcripts (~1s, no tokens, nothing
// uploaded). Scanned at the first ask (forced on a page reload), then hourly after a transcript changed and once at the day's
// close, whatever the window shows, since each day's last scan is kept as the history of past periods
export class UsageInsights {
  #agentRunner
  #file
  #insights  = null // the latest scan's promise, shared by concurrent callers
  #fetchedAt = 0
  #active    = false // a transcript changed since the last scan

  constructor(agentRunner, file = path.join(DATA_DIR, 'usage-insights.jsonl')) {
    this.#agentRunner = agentRunner
    this.#file        = file
  }

  start() {
    setInterval(() => this.tick(), 60_000)
  }

  // A transcript changed
  markActive() {
    this.#active = true
  }

  tick() {
    if (!this.#active) return
    const close = set(Date.now(), DAY_CLOSE)
    if (Date.now() - this.#fetchedAt >= EVERY || (Date.now() >= close && this.#fetchedAt < close)) this.#scan()
  }

  // The latest scan for a period still running, else the last snapshot kept within it (null if none)
  async get({ date, granularity, force = false }) {
    if (force || !this.#insights) this.#scan()
    const { start, end } = periodBounds(date, granularity)
    if (Date.now() <= end) return this.#insights
    return (await this.#read()).findLast(s => s.at >= start && s.at <= end) ?? null
  }

  // A failed scan (the API is experimental) keeps showing the last one, null before any
  #scan() {
    const previous  = this.#insights
    this.#fetchedAt = Date.now()
    this.#active    = false
    this.#insights  = this.#agentRunner.usage({ behaviors: true }).then(({ behaviors }) => {
      if (!behaviors) return previous
      const snapshot = { at: Date.now(), ...behaviors }
      this.#save(snapshot).catch(err => console.warn('[usage-insights] not saved:', err.message))
      return snapshot
    }, err => {
      console.warn('[usage-insights]', err.message)
      return previous
    })
  }

  // Replaces the day's snapshot with the newest, so the file stays oldest first
  async #save(snapshot) {
    const kept = [...(await this.#read()).filter(s => !isSameDay(s.at, snapshot.at)), snapshot]
    await fsp.mkdir(path.dirname(this.#file), { recursive: true })
    await writeFileAtomic(this.#file, kept.map(s => `${JSON.stringify(s)}\n`).join(''))
  }

  async #read() {
    try {
      return (await fsp.readFile(this.#file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)) // a day per line
    } catch {
      return [] // none yet, or unreadable: history starts over
    }
  }
}
