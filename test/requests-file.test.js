// $hash/$ref resolution + period filtering of src/main/sessions/RequestsFile.js
// (reads the NDJSON logs written by bin/capture-requests-proxy.mjs).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { RequestsFile } from '../src/main/sessions/RequestsFile.js'

const system = [{ type: 'text', text: 'You are Claude Code' }]
const userMsg = { role: 'user', content: 'hi' }
const assistantMsg = { role: 'assistant', content: 'hello' }

const records = [
  { type: 'api-request', timestamp: '2026-07-14T10:00:00.000Z', url: 'POST /v1/messages?beta=true', status: 200, durationMs: 100,
    request: { model: 'claude-sonnet-5', system: { $hash: 'aaa', value: system }, messages: [{ $hash: 'bbb', value: userMsg }] },
    response: { id: 'msg_1' } },
  { type: 'api-request', timestamp: '2026-07-15T10:00:00.000Z', url: 'POST /v1/messages?beta=true', status: 429, durationMs: 200,
    request: { model: 'claude-sonnet-5', system: { $ref: 'aaa' }, messages: [{ $ref: 'bbb' }, { $hash: 'ccc', value: assistantMsg }, { $ref: 'nope' }] },
    response: { type: 'error', error: { type: 'rate_limit_error' } } },
  { type: 'api-request', timestamp: '2026-07-15T11:00:00.000Z', url: 'POST /v1/messages/count_tokens', status: 200, durationMs: 50, model: 'claude-sonnet-5', size: 42 },
]

let dir
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-requests-'))
  fs.writeFileSync(path.join(dir, 'sess-1.requests.ndjson'),
    records.map(r => JSON.stringify(r)).join('\n') + '\nnot json\n')
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('RequestsFile', () => {
  it('resolves $hash/$ref back to full values, skipping malformed lines', async () => {
    const out = await new RequestsFile('sess-1', dir).read()
    expect(out).toHaveLength(3)
    expect(out[0].request.system).toEqual(system)
    expect(out[0].request.messages).toEqual([userMsg])
    expect(out[1].request.system).toEqual(system)
    expect(out[1].request.messages.slice(0, 2)).toEqual([userMsg, assistantMsg])
    expect(out[1].request.messages[2]).toEqual({ $ref: 'nope' }) // unknown ref stays a visible marker
    expect(out[2].request).toBeUndefined() // bare non-/v1/messages record passes through untouched
  })

  it('marks previously-seen parts ($refs) in $seen', async () => {
    const out = await new RequestsFile('sess-1', dir).read()
    expect(out[0].$seen).toEqual({ system: false, messages: [false] })
    expect(out[1].$seen).toEqual({ system: true, messages: [true, false, false] }) // unknown ref counts as unseen
    expect(out[2].$seen).toBeUndefined() // bare record has no request
  })

  it('filters by period but resolves refs across the whole file', async () => {
    const day15 = { start: Date.parse('2026-07-15T00:00:00.000Z'), end: Date.parse('2026-07-15T23:59:59.999Z') }
    const out = await new RequestsFile('sess-1', dir).read(day15)
    expect(out.map(r => r.timestamp)).toEqual(['2026-07-15T10:00:00.000Z', '2026-07-15T11:00:00.000Z'])
    expect(out[0].request.system).toEqual(system) // $ref target lives in the filtered-out day-14 record
  })

  it('returns [] when no log exists for the session', async () => {
    expect(await new RequestsFile('no-such-session', dir).read()).toEqual([])
  })
})
