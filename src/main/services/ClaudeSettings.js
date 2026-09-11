// Generic wrapper around <CLAUDE_DIR>/settings.json.
// Keep app-specific logic (hook/statusline names, etc.) in callers.
import fs from 'node:fs'
import { dirname } from 'node:path'
import { sync as writeFileAtomic } from 'write-file-atomic'
import { CLAUDE_SETTINGS } from '../paths.js'

const mtimeOf = path => fs.statSync(path, { throwIfNoEntry: false })?.mtimeMs

export class ClaudeSettings {
  constructor() {
    this.cfg = {}
    this.mtime = mtimeOf(CLAUDE_SETTINGS)
    if (this.mtime !== undefined) { // if there is no settings.json yet, start empty
      try {
        this.cfg = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
      } catch (err) {
        console.warn(`Failed to read ${CLAUDE_SETTINGS}: ${err.message}`)
        this.loadFailed = true
      }
    }
  }

  // Removes every hook (any event) whose command matches `pattern`, dropping groups and events
  // left empty. Returns the removed commands.
  removeHooks(pattern) {
    const matches = h => pattern.test(h.command ?? '')
    const removed = []
    for (const [event, groups] of Object.entries(this.cfg.hooks ?? {})) {
      const hit = groups.flatMap(g => (g.hooks ?? []).filter(matches).map(h => h.command))
      if (!hit.length) continue
      removed.push(...hit)
      for (const g of groups) g.hooks = (g.hooks ?? []).filter(h => !matches(h))
      this.cfg.hooks[event] = groups.filter(g => g.hooks.length)
      if (!this.cfg.hooks[event].length) delete this.cfg.hooks[event]
    }
    return removed
  }

  // Days Claude Code keeps transcripts before auto-deleting them; undefined when unset (its default is 30).
  get cleanupPeriodDays() {
    return this.cfg.cleanupPeriodDays
  }

  set cleanupPeriodDays(days) {
    if (days === undefined) delete this.cfg.cleanupPeriodDays
    else this.cfg.cleanupPeriodDays = days
  }

  // Claude Code's status line config: { type: 'command', command }; undefined when unset.
  get statusLine() {
    return this.cfg.statusLine
  }

  set statusLine(value) {
    if (value === undefined) delete this.cfg.statusLine
    else this.cfg.statusLine = value
  }

  // Environment variables Claude Code applies to every session; undefined when unset.
  get env() {
    return this.cfg.env
  }

  setEnv(name, value) {
    this.cfg.env ??= {}
    this.cfg.env[name] = value
  }

  deleteEnv(name) {
    delete this.cfg.env?.[name]
  }

  save() {
    if (this.loadFailed) throw new Error(`Refusing to save ${CLAUDE_SETTINGS}: settings did not load cleanly`)
    if (mtimeOf(CLAUDE_SETTINGS) !== this.mtime) throw new Error(`Refusing to save ${CLAUDE_SETTINGS}: file changed on disk since load`)
    fs.mkdirSync(dirname(CLAUDE_SETTINGS), { recursive: true })
    writeFileAtomic(CLAUDE_SETTINGS, JSON.stringify(this.cfg, null, 2))
  }
}
