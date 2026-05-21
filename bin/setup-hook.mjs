#!/usr/bin/env node
// Installs the capture-context hook into <CLAUDE_DIR>/settings.json.
// Idempotent: re-running is a no-op. Repairs stale paths in-place.
import { basename } from 'node:path'
import { CLAUDE_SETTINGS, HOOK_PATH } from '../src/main/paths.js'
import { ClaudeSettings } from '../src/main/services/ClaudeSettings.js'

const HOOK_FILE = basename(HOOK_PATH)
const HOOK_CMD  = `node "${HOOK_PATH}"`

const settings = new ClaudeSettings()
if (settings.loadFailed) {
  console.error(`Failed to load ${CLAUDE_SETTINGS} (missing or malformed)`)
  process.exit(1)
}

const existing = settings.hooks('InstructionsLoaded').find(h => h.command?.includes(HOOK_FILE))
if (!existing) {
  console.log(`Installing capture-context hook → ${HOOK_CMD}`)
  settings.addHook('InstructionsLoaded', HOOK_CMD)
} else if (existing.command === HOOK_CMD) {
  console.log(`Already installed in ${CLAUDE_SETTINGS}`)
  process.exit(0)
} else {
  console.log(`Repairing stale entry: ${existing.command} → ${HOOK_CMD}`)
  existing.command = HOOK_CMD
}

settings.save()
console.log(`Wrote ${CLAUDE_SETTINGS}. Restart your Claude Code sessions to start capturing.`)
