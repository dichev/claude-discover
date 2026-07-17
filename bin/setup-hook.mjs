#!/usr/bin/env node
// Sets up <CLAUDE_DIR>/settings.json for this app: installs the status line (also togglable from
// the app — the StatusBar's Status line tooltip button, backed by the same StatuslineController),
// raises transcript retention — and installs whatever hook entries the app needs (currently none).
// Idempotent: re-running is a no-op. Repairs stale paths in-place.
import { CLAUDE_SETTINGS } from '../src/main/paths.js'
import { ClaudeSettings } from '../src/main/services/ClaudeSettings.js'
import { StatuslineController, STATUS_CMD } from '../src/main/services/StatuslineController.js'

const RETAIN_DAYS = 365 // 1y; this app can only browse what Claude Code hasn't swept yet


console.log(`Installing into ${CLAUDE_SETTINGS}...`)

const settings = new ClaudeSettings()
if (settings.loadFailed) {
  console.error(`Failed to load ${CLAUDE_SETTINGS} (missing or malformed)`)
  process.exit(1)
}

let changed = false
const retention = settings.cleanupPeriodDays ?? 30 // Claude Code's default when unset
if (retention < RETAIN_DAYS) {
  console.log(` ✚ Retention: raising cleanupPeriodDays ${retention} → ${RETAIN_DAYS} so transcripts aren't swept`)
  settings.cleanupPeriodDays = RETAIN_DAYS
  settings.save()
  changed = true
} else {
  console.log(` ✓ Retention: cleanupPeriodDays already ${retention} (≥ ${RETAIN_DAYS})`)
}

const result = new StatuslineController().activate() // loads settings.json fresh, saves only on change
if (result.error) console.warn(` ⚠ Status line: ${result.error}`)
else if (result.changed) console.log(` ✚ Status line: installed → ${STATUS_CMD}`)
else console.log(` ✓ Status line: already installed`)
changed ||= result.changed

console.log(`--------------------------------------------`)
if (changed) console.log(`Wrote ${CLAUDE_SETTINGS}. Restart your Claude Code sessions to pick it up.`)
else console.log(`No changes needed in ${CLAUDE_SETTINGS}`)
