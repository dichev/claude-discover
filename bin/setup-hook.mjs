#!/usr/bin/env node
// Installs the capture-context hook into <CLAUDE_DIR>/settings.json.
// Idempotent: re-running is a no-op. Repairs stale paths in-place.
import { basename } from 'node:path'
import { CLAUDE_SETTINGS, HOOK_PATH, STATUSLINE_PATH, PROXY_URL } from '../src/main/paths.js'
import { ClaudeSettings } from '../src/main/services/ClaudeSettings.js'

const HOOK_FILE   = basename(HOOK_PATH)
const HOOK_CMD    = `node "${HOOK_PATH}"`
const HOOK_EVENTS = ['InstructionsLoaded', 'SessionStart', 'SessionEnd']
const STATUS_FILE = basename(STATUSLINE_PATH)
const STATUS_CMD  = `node "${STATUSLINE_PATH}"`
const RETAIN_DAYS = 365 // 1y; capturing context is pointless if Claude Code sweeps the transcripts first


console.log(`Installing into ${CLAUDE_SETTINGS}...`)

const settings = new ClaudeSettings()
if (settings.loadFailed) {
  console.error(`Failed to load ${CLAUDE_SETTINGS} (missing or malformed)`)
  process.exit(1)
}

let changed = false
for (const event of HOOK_EVENTS) {
  const existing = settings.findHook(event, HOOK_FILE)
  if (!existing) {
    console.log(` ✚ Installing capture-context hook on ${event} → ${HOOK_CMD}`)
    settings.addHook(event, HOOK_CMD)
    changed = true
  } else if (existing.command === HOOK_CMD) {
    console.log(` ✓ ${event} hook: already installed`)
  } else {
    console.log(` ↻ ${event} hook: repairing stale entry: ${existing.command} → ${HOOK_CMD}`)
    existing.command = HOOK_CMD
    changed = true
  }
}

// API request capture: point every Claude Code client at the logging proxy (bin/capture-requests-proxy.mjs).
// A foreign ANTHROPIC_BASE_URL (custom gateway) is never overwritten — capture just stays off.
const baseUrl = settings.env?.ANTHROPIC_BASE_URL
if (baseUrl && baseUrl !== PROXY_URL) {
  console.warn(` ⚠ Request capture: leaving your existing env.ANTHROPIC_BASE_URL in place (${baseUrl}); not overwriting — API request capture disabled.`)
} else {
  if (!baseUrl) {
    console.log(` ✚ Request capture: setting env.ANTHROPIC_BASE_URL → ${PROXY_URL}`)
    settings.setEnv('ANTHROPIC_BASE_URL', PROXY_URL)
    changed = true
  } else {
    console.log(` ✓ Request capture: env.ANTHROPIC_BASE_URL already points at the proxy`)
  }
  // Claude Code disables Tool Search (deferred tool loading) by default under a custom base URL, since most
  // proxies can't forward `tool_reference` blocks — so it eagerly ships every tool schema (~27k tokens/request).
  // Ours forwards verbatim to the real api.anthropic.com, so the round-trip works; re-enable it to keep the
  // savings. Only safe because upstream is genuinely Anthropic. https://code.claude.com/docs/en/env-vars
  if (settings.env?.ENABLE_TOOL_SEARCH !== 'true') {
    console.log(` ✚ Request capture: setting env.ENABLE_TOOL_SEARCH → true (restores deferred tool loading through the proxy)`)
    settings.setEnv('ENABLE_TOOL_SEARCH', 'true')
    changed = true
  } else {
    console.log(` ✓ Request capture: env.ENABLE_TOOL_SEARCH already true`)
  }
  console.log(`   Keep \`npm run proxy\` running — Claude Code can't reach the API without it (remove env.ANTHROPIC_BASE_URL from settings.json to turn capture off).`)
}

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
console.log(`Wrote ${CLAUDE_SETTINGS}. Restart your Claude Code sessions to start capturing.`)
