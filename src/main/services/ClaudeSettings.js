// Generic wrapper around <CLAUDE_DIR>/settings.json.
// Keep app-specific logic (capture-context hook names, etc.) in callers.
import fs from 'node:fs'
import { CLAUDE_SETTINGS } from '../paths.js'

const mtimeOf = path => fs.statSync(path, { throwIfNoEntry: false })?.mtimeMs

export class ClaudeSettings {
  constructor() {
    this.cfg = {}
    try {
      this.cfg = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
      this.mtime = mtimeOf(CLAUDE_SETTINGS)
    } catch (err) {
      console.warn(`Failed to read ${CLAUDE_SETTINGS}: ${err.message}`)
      this.loadFailed = true
    }
  }

  hooks(eventName) {
    return (this.cfg.hooks?.[eventName] ?? []).flatMap(g => g.hooks ?? [])
  }

  // Days Claude Code keeps transcripts before auto-deleting them; undefined when unset (its default is 30).
  get cleanupPeriodDays() {
    return this.cfg.cleanupPeriodDays
  }

  set cleanupPeriodDays(days) {
    this.cfg.cleanupPeriodDays = days
  }

  addHook(eventName, command) {
    this.cfg.hooks ??= {}
    this.cfg.hooks[eventName] ??= []
    this.cfg.hooks[eventName].push({ hooks: [{ type: 'command', command }] })
  }

  save() {
    if (this.loadFailed) throw new Error(`Refusing to save ${CLAUDE_SETTINGS}: settings did not load cleanly`)
    if (mtimeOf(CLAUDE_SETTINGS) !== this.mtime) throw new Error(`Refusing to save ${CLAUDE_SETTINGS}: file changed on disk since load`)
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(this.cfg, null, 2))
  }
}
