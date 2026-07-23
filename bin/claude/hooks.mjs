#!/usr/bin/env node
/*
Single entry point for every Claude Code hook this app installs — reads the hook event JSON from stdin
and dispatches on hook_event_name; add new hooks as new branches in main(). Standalone (no imports from
src/), wired into <CLAUDE_DIR>/settings.json by the app's ProxySwitch (StatusBar Activate/Deactivate button).

Currently handled:
- SessionStart → ensureProxy(): revive the request-capture proxy (bin/proxy.mjs) if it's
  down. settings.json's env.ANTHROPIC_BASE_URL survives a PC restart or proxy crash, and without this every
  Claude Code request would hit a dead port. A SessionStart hook's stdout is injected into the session
  context, so only stderr may speak — exit 1 shows the warning without blocking the session.

Copy-paste into <CLAUDE_DIR>/settings.json (replace the path):
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/TO/claude-discover/bin/claude/hooks.mjs" }] }
    ]
  }
}
*/


import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { text } from 'node:stream/consumers'
import { PROXY_URL, PING_ROUTE, PING_RESPONSE, DATA_DIR, ERROR_LOG_PATH } from '../proxy.config.js'


const DEBUG_LOG = false // Log every incoming hook event to DEBUG_LOG_FILE
const DEBUG_LOG_FILE = path.join(DATA_DIR, 'hooks.debug.log')
const ERROR_LOG = true // Log hook errors to ERROR_LOG_FILE
const ERROR_LOG_FILE = path.join(DATA_DIR, 'hooks.error.log')

const CLAUDE_HOOKS = {
  SESSION_START: 'SessionStart',
}

const PROXY_PATH = path.join(import.meta.dirname, '..', 'proxy.mjs')


function log(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${new Date().toISOString()} ${data}\n`)
  } catch {}
}


async function ping() {
  try {
    const res = await fetch(`${PROXY_URL}${PING_ROUTE}`, { signal: AbortSignal.timeout(1000) })
    return res.ok && (await res.text()) === PING_RESPONSE
  } catch { return false }
}


async function ensureProxy() {
  if (await ping()) return // the common case — one loopback round-trip per session start

  const child = spawn(process.execPath, [PROXY_PATH], { detached: true, stdio: 'ignore', windowsHide: true })
  const exited = new Promise(resolve => child.once('exit', resolve)) // idempotent: exits 0 when one is already listening
  child.unref()

  // Poll until it answers (startup includes a ≤5s upstream check), racing the child's exit.
  const settle = (async () => {
    for (let i = 0; i < 40; i++) {
      if (await ping()) return 'up'
      await new Promise(r => setTimeout(r, 200))
    }
    return 'unresponsive'
  })()

  const outcome = await Promise.race([exited, settle])
  if (outcome === 'up' || await ping()) return // up, or a proxy of ours won the race and is now answering

  // Exit 0 ("already running") + failed ping = a foreign process holds the port Claude Code sends API traffic to
  let msg = `capture proxy failed to start (see ${ERROR_LOG_PATH}) — Claude Code cannot reach the API until it runs; disable capture via the app's Stop button to unblock`
  if (outcome === 0) msg = `${PROXY_URL} is held by another process that is not the capture proxy — Claude Code is configured to send API traffic there`
  if (outcome === 2) msg = 'cannot reach api.anthropic.com — capture proxy not started'
  console.error('claude-discover: ' + msg)
  process.exitCode = 1
}


async function main() {
  const raw = await text(process.stdin)
  if (DEBUG_LOG) log(DEBUG_LOG_FILE, raw.trim())

  try {
    const event = JSON.parse(raw || '{}') // inside the try so a malformed payload is logged, not silently swallowed
    if (event.hook_event_name === CLAUDE_HOOKS.SESSION_START) {
      await ensureProxy()
    }
  }
  catch (err) {
    if (ERROR_LOG) log(ERROR_LOG_FILE, err?.stack || err)
  }
}

main().catch(() => {}).finally(() => process.exit(process.exitCode ?? 0))
