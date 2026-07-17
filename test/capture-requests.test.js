// Dedup + SSE reassembly + end-to-end forwarding/request logging of bin/capture-requests-proxy.mjs.
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { dedupeRequest, assembleSSE } from '../bin/capture-requests-proxy.mjs'
import { PROXY_PATH } from '../src/main/paths.js'

const body = {
  model: 'claude-sonnet-5',
  max_tokens: 64000,
  stream: true,
  thinking: { type: 'adaptive' },
  system: [
    { type: 'text', text: 'billing header' },
    { type: 'text', text: 'You are Claude Code', cache_control: { type: 'ephemeral' } },
  ],
  tools: [{ name: 'Read', description: 'reads', input_schema: {} }, { name: 'Bash', description: 'runs', input_schema: {} }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] },
    { role: 'system', content: 'Available agent types: …' },
  ],
}
const headers = { 'anthropic-beta': 'claude-code-20250219, effort-2025-11-24', 'user-agent': 'claude-cli/2.1.207' }
const HOST = '127.0.0.1'

describe('dedupeRequest', () => {
  it('keeps params verbatim, wraps bulk fields as { $hash, value } on first sight', () => {
    const out = dedupeRequest(body)
    expect(out).toMatchObject({ model: 'claude-sonnet-5', max_tokens: 64000, stream: true, thinking: { type: 'adaptive' } })
    expect(out.system.value).toEqual(body.system)
    expect(out.tools.value).toEqual(body.tools)
    expect(out.messages.map(m => m.value)).toEqual(body.messages)
    for (const x of [out.system, out.tools, ...out.messages]) expect(x.$hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('replaces seen values with { $ref } — only the new conversation tail stays full', () => {
    const seen = new Set()
    dedupeRequest(body, seen)
    const next = dedupeRequest({ ...body, messages: [...body.messages, { role: 'assistant', content: 'hello' }] }, seen)
    expect(next.system).toEqual({ $ref: expect.any(String) })
    expect(next.tools).toEqual({ $ref: expect.any(String) })
    expect(next.messages.slice(0, 2).every(m => m.$ref)).toBe(true)
    expect(next.messages[2].value).toEqual({ role: 'assistant', content: 'hello' })
  })

  it('hashes ignore cache_control — moving breakpoints do not re-log content', () => {
    const seen = new Set()
    dedupeRequest(body, seen)
    const moved = {
      ...body,
      system: [{ type: 'text', text: 'billing header' }, { type: 'text', text: 'You are Claude Code' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'system', content: 'Available agent types: …' },
      ],
    }
    const out = dedupeRequest(moved, seen)
    expect(out.system.$ref).toBeDefined()
    expect(out.messages.every(m => m.$ref)).toBe(true)
  })
})

const sse = events => events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
const streamEvents = [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig==' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'ping' },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hel' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'lo' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"file_pa' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'th":"a.js"}' } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 25 } },
  { type: 'message_stop' },
]

describe('assembleSSE', () => {
  it('folds the stream into the final message', () => {
    const msg = assembleSSE(sse(streamEvents))
    expect(msg).toMatchObject({ id: 'msg_1', role: 'assistant', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 25 } })
    expect(msg.content).toEqual([
      { type: 'thinking', thinking: 'hmm', signature: 'sig==' },
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.js' } },
    ])
  })

  it('returns an API error event as-is', () => {
    const err = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
    expect(assembleSSE(sse([streamEvents[0], err]))).toEqual(err)
  })

  it('degrades to $sseParseError on malformed or truncated streams', () => {
    expect(assembleSSE('data: {not json\n\n').$sseParseError).toBeDefined()
    expect(assembleSSE('').$sseParseError).toBeDefined()
  })
})

const freePort = () => new Promise(resolve => {
  const srv = net.createServer()
  srv.listen(0, HOST, () => { const { port } = srv.address(); srv.close(() => resolve(port)) })
})

const waitForPort = async port => {
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise(resolve => {
      const s = net.connect({ port, host: HOST })
      s.once('connect', () => { s.destroy(); resolve(true) })
      s.once('error', () => resolve(false))
    })
    if (ok) return
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`proxy never listened on ${port}`)
}

describe('proxy end-to-end', () => {
  let claudeDir, upstream, upstreamPort, proxyPort, proxy
  const received = []
  const readRequestLog = () => fs.readFileSync(path.join(claudeDir, 'requests', 'sess-e2e.requests.ndjson'), 'utf8').trim().split('\n').map(JSON.parse)

  const startProxy = async (...extraArgs) => {
    proxy = spawn(process.execPath, [PROXY_PATH, '--port', String(proxyPort), '--upstream', `http://${HOST}:${upstreamPort}`, ...extraArgs], {
      stdio: 'ignore',
      env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
    })
    await waitForPort(proxyPort)
    received.length = 0 // drop the proxy's own startup upstream check (GET /v1/models)
  }

  beforeAll(async () => {
    claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-proxy-'))
    upstream = http.createServer((req, res) => {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
        if (req.url.startsWith('/v1/messages') && !req.url.includes('count_tokens')) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.end(sse(streamEvents))
        } else {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        }
      })
    })
    upstreamPort = await freePort()
    await new Promise(r => upstream.listen(upstreamPort, HOST, r))
    proxyPort = await freePort()
    await startProxy()
  }, 15000)

  afterAll(() => {
    proxy?.kill()
    upstream?.close()
    fs.rmSync(claudeDir, { recursive: true, force: true })
  })

  const post = () => fetch(`http://${HOST}:${proxyPort}/v1/messages?beta=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'k', 'x-claude-code-session-id': 'sess-e2e', ...headers },
    body: JSON.stringify(body),
  })

  it('forwards verbatim (minus accept-encoding) and streams the SSE response back untouched', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(sse(streamEvents))
    expect(received[0].url).toBe('/v1/messages?beta=true')
    expect(received[0].headers['x-api-key']).toBe('k')
    expect(received[0].headers['accept-encoding']).toBeUndefined()
    expect(JSON.parse(received[0].body)).toEqual(body)
  })

  it('logs the full request + assembled response, then $refs on the repeat', async () => {
    await post()
    const records = readRequestLog()
    expect(records).toHaveLength(2)
    const [first, second] = records
    expect(first).toMatchObject({
      type: 'api-request',
      url: 'POST /v1/messages?beta=true',
      status: 200,
    })
    expect(first.requestHeaders).toMatchObject(headers) // anthropic-beta + user-agent captured verbatim
    expect(first.requestHeaders['x-api-key']).toBe('<redacted>') // key kept, credential never logged
    expect(first.responseHeaders['content-type']).toBe('text/event-stream')
    expect(first.durationMs).toBeGreaterThanOrEqual(0)
    expect(first.request.system.value).toEqual(body.system)
    expect(first.request.messages.map(m => m.value)).toEqual(body.messages)
    expect(first.response).toMatchObject({ id: 'msg_1', stop_reason: 'tool_use' })
    expect(first.response.content[1]).toEqual({ type: 'text', text: 'Hello' })
    // identical context re-sent → everything bulky becomes a $ref
    expect(second.request.system.$ref).toBe(first.request.system.$hash)
    expect(second.request.tools.$ref).toBe(first.request.tools.$hash)
    expect(second.request.messages.map(m => m.$ref)).toEqual(first.request.messages.map(m => m.$hash))
  })

  it('warms the seen-set from the request log after a restart — no re-logging', async () => {
    proxy.kill()
    await new Promise(r => proxy.once('exit', r))
    await startProxy()
    await post()
    const last = readRequestLog().at(-1)
    expect(last.request.system.$ref).toBeDefined()
    expect(last.request.messages.every(m => m.$ref)).toBe(true)
  }, 15000)

  it('logs other endpoints as bare url+status+size lines', async () => {
    const res = await fetch(`http://${HOST}:${proxyPort}/v1/messages/count_tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-claude-code-session-id': 'sess-e2e' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
    })
    expect(res.status).toBe(200)
    const last = readRequestLog().at(-1)
    expect(last).toMatchObject({ type: 'api-request', url: 'POST /v1/messages/count_tokens', model: 'claude-sonnet-5', status: 200 })
    expect(last.request).toBeUndefined()
    expect(last.response).toBeUndefined()
    expect(last.size).toBeGreaterThan(0)
  })

  it('--restart replaces the running instance and takes over the port', async () => {
    const old = proxy
    const oldExited = new Promise(r => old.once('exit', r))
    await startProxy('--restart') // waitForPort may still hit the old instance here…
    await oldExited               // …so wait for it to die, then for the new one to grab the port
    await waitForPort(proxyPort)
    const before = readRequestLog().length
    const res = await post()
    expect(res.status).toBe(200)
    await res.text() // the record is written when the upstream response closes — drain, then poll for it
    while (readRequestLog().length === before) await new Promise(r => setTimeout(r, 25))
    expect(readRequestLog().at(-1).request.messages.every(m => m.$ref)).toBe(true) // new instance warmed its seen-set
  }, 15000)

  it('answers the ping route itself, without forwarding upstream', async () => {
    const before = received.length
    const res = await fetch(`http://${HOST}:${proxyPort}/claude-discover/ping`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('claude-discover-proxy')
    expect(received.length).toBe(before)
  })

  it('exits with code 2 at startup when the upstream is unreachable', async () => {
    const dead = spawn(process.execPath, [PROXY_PATH, '--port', String(await freePort()), '--upstream', `http://${HOST}:${await freePort()}`], {
      stdio: 'ignore',
      env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
    })
    expect(await new Promise(r => dead.once('exit', r))).toBe(2)
  }, 15000)

  it('ignores requests without a session id', async () => {
    const res = await fetch(`http://${HOST}:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(200)
    expect(fs.readdirSync(path.join(claudeDir, 'requests'))).toEqual(['sess-e2e.requests.ndjson'])
  })
})
