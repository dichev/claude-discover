// Raise/reset Claude Code's transcript retention (cleanupPeriodDays in settings.json) —
// this app can only browse what Claude Code hasn't swept yet. Backs the StatusBar's
// Activate/Deactivate button; sole owner of that config.
import { ClaudeSettings } from './ClaudeSettings.js'

const DEFAULT_DAYS = 30 // Claude Code's default when unset
const RETAIN_DAYS = 365 // 1y

export class RetentionController {

  status() {
    const days = new ClaudeSettings().cleanupPeriodDays ?? DEFAULT_DAYS
    return { days, raised: days >= RETAIN_DAYS }
  }

  // Raise retention to RETAIN_DAYS; an already-higher value is left as is.
  activate() {
    try {
      const settings = new ClaudeSettings() // fresh — settings.json may have changed since app launch
      if ((settings.cleanupPeriodDays ?? DEFAULT_DAYS) < RETAIN_DAYS) {
        settings.cleanupPeriodDays = RETAIN_DAYS
        settings.save()
      }
      return this.status()
    } catch (err) {
      return this.#fail(String(err?.message || err))
    }
  }

  // Remove the setting — back to Claude Code's default.
  deactivate() {
    try {
      const settings = new ClaudeSettings()
      if (settings.cleanupPeriodDays !== undefined) {
        settings.cleanupPeriodDays = undefined
        settings.save()
      }
      return this.status()
    } catch (err) {
      return this.#fail(String(err?.message || err))
    }
  }

  #fail(error) {
    return { ...this.status(), error }
  }
}
