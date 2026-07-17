#!/usr/bin/env node
// Sets up <CLAUDE_DIR>/settings.json for this app: installs the status line, raises transcript
// retention — and installs whatever hook entries the app needs (currently none).
// Idempotent: re-running is a no-op. Repairs stale paths in-place.
import { basename } from 'node:path'
import { CLAUDE_SETTINGS, STATUSLINE_PATH } from '../src/main/paths.js'
import { ClaudeSettings } from '../src/main/services/ClaudeSettings.js'

const STATUS_FILE = basename(STATUSLINE_PATH)
const STATUS_CMD  = `node "${STATUSLINE_PATH}"`
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
  changed = true
} else {
  console.log(` ✓ Retention: cleanupPeriodDays already ${retention} (≥ ${RETAIN_DAYS})`)
}

const statusLine = settings.statusLine
if (!statusLine?.command) {
  console.log(` ✚ Status line: installing → ${STATUS_CMD}`)
  settings.statusLine = { type: 'command', command: STATUS_CMD }
  changed = true
} else if (statusLine.command.includes(STATUS_FILE)) {
  if (statusLine.command === STATUS_CMD) {
    console.log(` ✓ Status line: already installed`)
  } else {
    console.log(` ↻ Status line: repairing stale entry: ${statusLine.command} → ${STATUS_CMD}`)
    statusLine.command = STATUS_CMD
    changed = true
  }
} else {
  console.warn(` ⚠ Status line: leaving your existing status line in place (${statusLine.command}); not overwriting. Set it to "${STATUS_CMD}" manually to use ours.`)
}

console.log(`--------------------------------------------`)
if (!changed) {
  console.log(`No changes needed in ${CLAUDE_SETTINGS}`)
  process.exit(0)
}

settings.save()
console.log(`Wrote ${CLAUDE_SETTINGS}. Restart your Claude Code sessions to pick it up.`)
