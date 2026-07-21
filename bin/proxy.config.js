// Shared config for the request-capture proxy (bin/proxy.mjs) — the single place its port,
// routes, ping body and paths are defined, imported by bin/ and src/main/. Sole exception:
// the renderer doesn't import from bin/, so StatusBar's tooltip hardcodes PROXY_URL.

import os from 'node:os'
import path from 'node:path'

export const HOST      = '127.0.0.1' // loopback only, on purpose — the proxy sees auth headers and must never listen on external interfaces
export const PORT      = process.env.CLAUDE_DISCOVER_PORT || 41414 // arbitrary uncommon port (unregistered, unlikely to collide); env override used only by tests
export const PROXY_URL = `http://${HOST}:${PORT}`
export const UPSTREAM  = process.env.CLAUDE_DISCOVER_UPSTREAM || 'https://api.anthropic.com' // env override used only by tests

export const EXIT_ROUTE    = '/claude-discover/exit' // POST here makes the proxy exit — how --restart replaces a running instance (the port is loopback-only and assumed ours)
export const PING_ROUTE    = '/claude-discover/ping' // answered directly (never forwarded) — polled by the app's ProxySwitch to show/settle the running state
export const PING_RESPONSE = 'claude-discover-proxy' // the ping body — proves it's this proxy on the port, not some other process

export const PROJECT_DIR    = process.env.CLAUDE_DISCOVER_DIR || path.join(os.homedir(), '.claude-discover') // global on purpose — session ids are unique, so one flat dir serves every Claude dir (env override used only by tests)
export const REQUESTS_DIR   = path.join(PROJECT_DIR, 'requests') // logs are kept forever — nothing deletes them
export const ERROR_LOG_PATH = path.join(PROJECT_DIR, 'proxy.error.log') // capture errors — capture must never fail a request
