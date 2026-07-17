#!/usr/bin/env node
// Cleans up everything left behind by the retired capture-context hook (instructions are now
// extracted from the request-capture proxy's logs instead): its hook entries in
// <CLAUDE_DIR>/settings.json and the <session>.context.ndjson sidecars next to the transcripts.
// Dry-run by default — prints what it would remove; pass --force to actually remove.
//
// Usage: node bin/remove-context-logs-and-hooks.mjs [--force]
import fs from 'node:fs'
import path from 'node:path'
import { CLAUDE_PROJECTS_DIR, CLAUDE_SETTINGS } from '../src/main/paths.js'
import { ClaudeSettings } from '../src/main/services/ClaudeSettings.js'

const force = process.argv.includes('--force')
const OLD_HOOK = 'capture-context.hook.mjs'

// The hook entries in settings.json (removeHook only mutates in memory — saved only with --force)
const settings = new ClaudeSettings()
let hookEntries = 0
for (const event of ['InstructionsLoaded', 'SessionStart', 'SessionEnd']) {
  for (const cmd of settings.loadFailed ? [] : settings.removeHook(event, OLD_HOOK)) {
    console.log(` ${force ? '✖ Removing' : '· Would remove'} ${event} hook entry in ${CLAUDE_SETTINGS}: ${cmd}`)
    hookEntries++
  }
}
if (force && hookEntries) settings.save()

// The .context.ndjson sidecars the hook wrote next to the transcripts
const files = fs.existsSync(CLAUDE_PROJECTS_DIR)
  ? fs.readdirSync(CLAUDE_PROJECTS_DIR, { recursive: true, withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.context.ndjson'))
      .map(e => path.join(e.parentPath, e.name))
  : []

let bytes = 0
for (const file of files) {
  bytes += fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0
  console.log(` ${force ? '✖ Deleting' : '· Would delete'} ${file}`)
  if (force) fs.rmSync(file, { force: true })
}

console.log(`--------------------------------------------`)
if (!hookEntries && !files.length) {
  console.log(`Nothing to clean up — no hook entries or .context.ndjson files found`)
} else {
  console.log(`${force ? 'Removed' : 'Found'} ${hookEntries} hook entries and ${files.length} files (${(bytes / 1024).toFixed(1)} KB)${force ? '' : '. Rerun with --force to remove them.'}`)
}
