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

  hooks(eventName) {
    return (this.cfg.hooks?.[eventName] ?? []).flatMap(g => g.hooks ?? [])
  }

  // The hook entry on this event whose command mentions `needle` (basename, so stale absolute paths still match), or undefined.
  findHook(eventName, needle) {
    return this.hooks(eventName).find(h => h.command?.includes(needle))
  }


  // Removes every hook on this event whose command mentions `needle` (basename, so stale
  // absolute paths still match); groups left empty are dropped. Returns the removed commands.
  removeHook(eventName, needle) {
    const matches = h => h.command?.includes(needle)
    const groups = this.cfg.hooks?.[eventName] ?? []
    const removed = groups.flatMap(g => (g.hooks ?? []).filter(matches).map(h => h.command))
    if (removed.length) {
      for (const g of groups) g.hooks = (g.hooks ?? []).filter(h => !matches(h))
      this.cfg.hooks[eventName] = groups.filter(g => g.hooks.length)
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

  addHook(eventName, command) {
    this.cfg.hooks ??= {}
    this.cfg.hooks[eventName] ??= []
    this.cfg.hooks[eventName].push({ hooks: [{ type: 'command', command }] })
  }

  save() {
    if (this.loadFailed) throw new Error(`Refusing to save ${CLAUDE_SETTINGS}: settings did not load cleanly`)
    if (mtimeOf(CLAUDE_SETTINGS) !== this.mtime) throw new Error(`Refusing to save ${CLAUDE_SETTINGS}: file changed on disk since load`)
    fs.mkdirSync(dirname(CLAUDE_SETTINGS), { recursive: true })
    writeFileAtomic(CLAUDE_SETTINGS, JSON.stringify(this.cfg, null, 2))
  }
}
