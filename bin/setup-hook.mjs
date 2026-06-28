#!/usr/bin/env node
// Installs the capture-context hook into <CLAUDE_DIR>/settings.json.
// Idempotent: re-running is a no-op. Repairs stale paths in-place.
import { basename } from 'node:path'
import { CLAUDE_SETTINGS, HOOK_PATH } from '../src/main/paths.js'
import { ClaudeSettings } from '../src/main/services/ClaudeSettings.js'

const HOOK_FILE   = basename(HOOK_PATH)
const HOOK_CMD    = `node "${HOOK_PATH}"`
const HOOK_EVENTS = ['InstructionsLoaded', 'SessionStart', 'SessionEnd']
const RETAIN_DAYS = 365 // 1y; capturing context is pointless if Claude Code sweeps the transcripts first


console.log(`Installing capture-context hook into ${CLAUDE_SETTINGS}...`)

const settings = new ClaudeSettings()
if (settings.loadFailed) {
  console.error(`Failed to load ${CLAUDE_SETTINGS} (missing or malformed)`)
  process.exit(1)
}

let changed = false
for (const event of HOOK_EVENTS) {
  const existing = settings.hooks(event).find(h => h.command?.includes(HOOK_FILE))
  if (!existing) {
    console.log(` • Installing capture-context hook on ${event} → ${HOOK_CMD}`)
    settings.addHook(event, HOOK_CMD)
    changed = true
  } else if (existing.command === HOOK_CMD) {
    console.log(` • ${event} hook: already installed`)
  } else {
    console.log(` • ${event} hook: repairing stale entry: ${existing.command} → ${HOOK_CMD}`)
    existing.command = HOOK_CMD
    changed = true
  }
}

const retention = settings.cleanupPeriodDays ?? 30 // Claude Code's default when unset
if (retention < RETAIN_DAYS) {
  console.log(` • Retention: raising cleanupPeriodDays ${retention} → ${RETAIN_DAYS} so transcripts aren't swept`)
  settings.cleanupPeriodDays = RETAIN_DAYS
  changed = true
} else {
  console.log(` • Retention: cleanupPeriodDays already ${retention} (≥ ${RETAIN_DAYS})`)
}

console.log(`--------------------------------------------`)
if (!changed) {
  console.log(`No changes needed in ${CLAUDE_SETTINGS}`)
  process.exit(0)
}

settings.save()
console.log(`Wrote ${CLAUDE_SETTINGS}. Restart your Claude Code sessions to start capturing.`)
