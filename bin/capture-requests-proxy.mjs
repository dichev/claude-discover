// Local logging proxy for Claude Code's API traffic — captures what transcripts never record
// (system prompt, tool definitions, injected reminders, request params) plus the raw responses.
// Claude Code is pointed at it via env.ANTHROPIC_BASE_URL (installed by the app's StatusBar
// Activate button); started manually with `npm run proxy`. Capture must never fail or delay a request — errors go
// to <CLAUDE_DIR>/.claude-discover/proxy.error.log instead of the client.
//
// Usage: node bin/capture-requests-proxy.mjs [--restart] [--port 41414] [--upstream https://api.anthropic.com]

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'


const HOST = '127.0.0.1' // loopback only, on purpose — the proxy sees auth headers and must never listen on external interfaces
export const PORT = 41414 // also hardcoded as PROXY_URL in src/main/paths.js; imported by bin/claude/hooks.mjs
const UPSTREAM = 'https://api.anthropic.com'
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const LOG_DIR = path.join(CLAUDE_DIR, '.claude-discover') // this app's data under the Claude dir
const REQUESTS_DIR = path.join(LOG_DIR, 'requests') // orphaned logs are swept by the app (RequestFile.sweepOrphans), not here
export const ERROR_LOG_PATH = path.join(LOG_DIR, 'proxy.error.log')
export const EXIT_ROUTE = '/claude-discover/exit' // POST here makes the proxy exit — how --restart replaces a running instance (the port is loopback-only and assumed ours)
export const PING_ROUTE = '/claude-discover/ping' // answered directly (never forwarded) — polled by the app's ProxySwitch to show/settle the running state
export const PING_RESPONSE = 'claude-discover-proxy' // the ping body — proves it's this proxy on the port, not some other process


// ── 1. Generic tee proxy — knows nothing about Claude ────────────────────────
// Forwards verbatim to `upstream` and pipes the response back while buffering both bodies.
// `onExchange(exchange)` fires exactly once per request, after piping (its response fields are
// undefined when upstream never responded); `errorBody(err)` shapes the 502 when it's unreachable.

function createProxy({ upstream, onExchange, onError, errorBody }) {
  const mod = upstream.protocol === 'http:' ? http : https

  return http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === EXIT_ROUTE) return res.end('bye', () => process.exit(0))
    if (req.url === PING_ROUTE) return res.end(PING_RESPONSE)
    const started = Date.now()
    let requestBody
    try { requestBody = Buffer.concat(await req.toArray()) } catch { return res.destroy() }

    let done = false // response 'close' and upstream 'error' can race — fire onExchange exactly once
    const finish = (status, responseHeaders, responseBody) => {
      if (done) return
      done = true
      const exchange = { req, requestBody, status, responseHeaders, responseBody, timestamp: new Date(started).toISOString(), durationMs: Date.now() - started }
      try { onExchange(exchange) } catch (err) { onError(err, `logging ${req.method} ${req.url}`) }
    }

    const headers = { ...req.headers, host: upstream.host }
    delete headers.connection

    // Claude code offers "gzip, deflate, br, zstd", but we accept gzip only to keep it simple
    if (/\bgzip\b/.test(headers['accept-encoding'] ?? '')) {
      headers['accept-encoding'] = 'gzip'
    } else {
      delete headers['accept-encoding']
    }

    const up = mod.request(new URL(req.url, upstream), { method: req.method, headers }, upRes => {
      const resHeaders = { ...upRes.headers }
      delete resHeaders['transfer-encoding'] // node re-frames the piped body itself
      delete resHeaders.connection
      res.writeHead(upRes.statusCode, resHeaders)
      const chunks = []
      upRes.on('data', c => chunks.push(c))
      upRes.pipe(res)
      // 'close' fires after 'end' and also on an aborted stream — a truncated body is still captured
      upRes.on('close', () => finish(upRes.statusCode, upRes.headers, decode(upRes.headers['content-encoding'], Buffer.concat(chunks))))
    })
    up.on('error', err => {
      onError(err, `${req.method} ${req.url} → ${upstream.host}`)
      finish()
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
      res.end(errorBody(err))
    })
    up.end(requestBody)
  })
}

// gzip is the only encoding ever advertised upstream, so it's the only decoder needed.
// Z_SYNC_FLUSH tolerates a truncated stream (aborted response) and yields what did decompress.
function decode(encoding, buf) {
  if (encoding !== 'gzip') return buf.toString('utf8')
  try { return zlib.gunzipSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8') } catch { return buf.toString('utf8') }
}

// ── 2. Claude Code capture ───────────────────────────────────────────────────
// One NDJSON record per exchange in <CLAUDE_DIR>/.claude-discover/requests/<sessionId>.requests.jsonl
// (session id from the X-Claude-Code-Session-Id header).

function logRequest({ req, requestBody, status, responseHeaders, responseBody, timestamp, durationMs }) {
  const sessionId = req.headers['x-claude-code-session-id']
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) return // header value becomes a filename — accept only safe ids
  const logPath = path.join(REQUESTS_DIR, `${sessionId}.requests.jsonl`)
  const record = { type: 'api-request', timestamp, url: `${req.method} ${req.url}`, status, durationMs }
  let body
  try { body = JSON.parse(requestBody.toString('utf8')) } catch {}
  if (body && req.method === 'POST' && req.url.split('?')[0] === '/v1/messages') {
    record.requestHeaders = { ...req.headers }
    for (const h of ['authorization', 'x-api-key', 'cookie']) if (h in record.requestHeaders) record.requestHeaders[h] = '<redacted>' // keep the key, never the credential
    record.responseHeaders = responseHeaders
    record.request = dedupeRequest(body, seenFor(sessionId, logPath))
    record.response = parseResponse(responseHeaders?.['content-type'], responseBody)
  } else {
    // Any other endpoint or an unparsable body: url/status/size only.
    record.model = body?.model
    record.size = requestBody.length
  }
  fs.mkdirSync(REQUESTS_DIR, { recursive: true })
  fs.appendFileSync(logPath, JSON.stringify(record) + '\n')
}

function parseResponse(contentType, text) {
  if (text == null) return undefined // upstream never responded — the attempt is logged without a response
  if (contentType?.includes('text/event-stream')) return assembleSSE(text)
  try { return JSON.parse(text) } catch { return text.slice(0, 20_000) }
}

// Folds a raw SSE stream back into the final API message — what a non-streaming request would have
// returned. Malformed/truncated streams degrade to { $sseParseError, raw } instead of throwing.
export function assembleSSE(text) {
  try {
    let message
    const partialJson = {} // content index → accumulated input_json_delta string
    for (const chunk of text.split(/\r?\n\r?\n/)) {
      const data = chunk.split(/\r?\n/).find(l => l.startsWith('data:'))
      if (!data) continue
      const ev = JSON.parse(data.slice(5))
      const block = message?.content[ev.index]
      switch (ev.type) {
        case 'message_start': message = ev.message; break
        case 'content_block_start': message.content[ev.index] = ev.content_block; break
        case 'content_block_delta': {
          const d = ev.delta
          if (d.type === 'text_delta') block.text += d.text
          else if (d.type === 'thinking_delta') block.thinking += d.thinking
          else if (d.type === 'signature_delta') block.signature = (block.signature ?? '') + d.signature
          else if (d.type === 'input_json_delta') partialJson[ev.index] = (partialJson[ev.index] ?? '') + d.partial_json
          break
        }
        case 'content_block_stop': if (ev.index in partialJson) block.input = JSON.parse(partialJson[ev.index] || '{}'); break
        case 'message_delta': Object.assign(message, ev.delta); Object.assign(message.usage ??= {}, ev.usage); break
        case 'error': return ev
      }
    }
    if (!message) throw new Error('no message_start event')
    return message
  } catch (err) {
    return { $sseParseError: String(err?.message || err), raw: text.slice(0, 20_000) }
  }
}

// ── 3. Dedup hashing ─────────────────────────────────────────────────────────
// The API re-sends the whole conversation each turn, so each bulk value is logged in full
// ({ $hash, value }) only the first time, then as { $ref }; readers rebuild the map top-down.

// The logged request body: params verbatim, bulk fields (system, tools, each message) deduped.
export function dedupeRequest(body, seen = new Set()) {
  const dedupe = (value, minSize = 0) => {
    // hash with cache_control stripped — breakpoints move between requests, unchanged content must still match
    const json = JSON.stringify(value, (k, v) => k === 'cache_control' ? undefined : v)
    if (json.length < minSize) return value // tiny values aren't worth a wrapper
    const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16)
    if (seen.has(hash)) return { $ref: hash }
    seen.add(hash)
    return { $hash: hash, value: deep(value) }
  }
  // Inside a newly-seen value, array elements (content blocks, tool schemas, …) are deduped
  // individually too, at any depth — one injected/updated element (e.g. a system-reminder)
  // must not re-log its siblings.
  const deep = v =>
    Array.isArray(v) ? v.map(el => dedupe(el, 256))
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]))
    : v
  const out = { ...body }
  if (out.system != null) out.system = dedupe(out.system)
  if (out.tools != null) out.tools = dedupe(out.tools)
  if (out.messages) out.messages = out.messages.map(dedupe)
  return out
}

// Warm the seen-set from the request log on first touch, so a proxy restart doesn't re-log full values.
const seenHashes = new Map() // sessionId → Set of hashes already logged in full
function seenFor(sessionId, logPath) {
  let seen = seenHashes.get(sessionId)
  if (!seen) seenHashes.set(sessionId, seen = warmFromLog(logPath))
  return seen
}

function warmFromLog(logPath) {
  const seen = new Set()
  const walk = v => { // collect every $hash at any depth
    if (!v || typeof v !== 'object') return
    if (v.$hash) seen.add(v.$hash)
    for (const x of Object.values(v)) walk(x)
  }
  let lines = []
  try { lines = fs.readFileSync(logPath, 'utf8').split('\n') } catch {}
  for (const line of lines) {
    try { walk(JSON.parse(line).request) } catch {}
  }
  return seen
}

// ── Entry point ──────────────────────────────────────────────────────────────


// Capture/upstream errors land here instead of ever reaching the client.
function logError(err, context) {
  try { // AggregateError (e.g. all of a host's addresses failed to connect) hides the detail in err.errors
    const causes = (err?.errors ?? []).map(e => `\n  cause: ${e?.message || e}`).join('')
    const message = `${new Date().toISOString()} ${context ? `[${context}] ` : ''}${err?.stack || err}${causes}\n`
    fs.mkdirSync(path.dirname(ERROR_LOG_PATH), { recursive: true }) // the error may fire before any request write creates the dir
    fs.appendFileSync(ERROR_LOG_PATH, message)
  } catch {}
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = parseArgs({
    options: {
      restart: { type: 'boolean' }, // replace an already-running instance instead of exiting
      port: { type: 'string' },     // overridden only by tests
      upstream: { type: 'string' }  // overridden only by tests
    }
  })
  const port = Number(args.values.port || PORT)
  const upstream = new URL(args.values.upstream || UPSTREAM)
  // Fail fast when the upstream is unreachable — a clear exit beats a proxy that 502s every request.
  // Runs before --restart so a working instance is never replaced by a broken one. Exit code 2 is
  // recognized by the app's ProxySwitch ("cannot reach upstream").
  try {
    await fetch(new URL('/v1/models', upstream), { signal: AbortSignal.timeout(5000) })
  } catch (err) {
    console.error(`Cannot reach ${upstream.origin} (${err?.cause?.code || err?.cause?.message || err?.name || err})`)
    logError(err, `startup check → ${upstream.origin}`)
    process.exit(2)
  }
  const server = createProxy({
    upstream: upstream,
    onExchange: logRequest,
    onError: logError,
    errorBody: err => JSON.stringify({ type: 'error', error: { type: 'api_error', message: `claude-discover proxy: upstream unreachable (${err.code || err.message})` } }),
  })
  if (args.values.restart) {
    // Ask a previous instance (the port is loopback-only and assumed ours) to exit before listening.
    const replaced = await new Promise(resolve => http.request(`http://${HOST}:${port}${EXIT_ROUTE}`, { method: 'POST' }, () => resolve(true)).on('error', () => resolve(false)).end())
    if (replaced) {
      console.log(`Replacing running proxy on ${HOST}:${port}...`)
      await new Promise(resolve => setTimeout(resolve, 500)) // give it a moment to release the port
    }
  }
  server.on('error', err => {
    if (err.code === 'EADDRINUSE' && args.values.restart) { console.error(`Failed to restart: ${HOST}:${port} is still busy`); process.exit(1) }
    if (err.code === 'EADDRINUSE') { console.log(`Capture proxy already running on ${HOST}:${port}`); process.exit(0) }
    logError(err)
    process.exit(1)
  })
  server.listen(port, HOST, () => console.log(`Capture proxy listening on http://${HOST}:${port} → ${upstream.origin}\nLogging requests to ${REQUESTS_DIR}`))
}
