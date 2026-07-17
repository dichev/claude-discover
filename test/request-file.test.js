// $hash/$ref resolution, period filtering and system-prompt/memory-file extraction of src/main/requests/
// RequestFile.js + RequestParser.js (reads the NDJSON logs written by bin/capture-requests-proxy.mjs).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { RequestFile } from '../src/main/requests/RequestFile.js'
import { parseClaudeMd } from '../src/main/requests/RequestParser.js'

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
  fs.writeFileSync(path.join(dir, 'sess-1.requests.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\nnot json\n')
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('RequestFile', () => {
  it('resolves $hash/$ref back to full values, skipping malformed lines', async () => {
    const out = await new RequestFile('sess-1', dir).read()
    expect(out).toHaveLength(3)
    expect(out[0].request.system).toEqual(system)
    expect(out[0].request.messages).toEqual([userMsg])
    expect(out[1].request.system).toEqual(system)
    expect(out[1].request.messages.slice(0, 2)).toEqual([userMsg, assistantMsg])
    expect(out[1].request.messages[2]).toEqual({ $ref: 'nope' }) // unknown ref stays a visible marker
    expect(out[2].request).toBeUndefined() // bare non-/v1/messages record passes through untouched
  })

  it('marks previously-seen parts ($refs) in $seen', async () => {
    const out = await new RequestFile('sess-1', dir).read()
    expect(out[0].$seen).toEqual({ system: false, messages: [false] })
    expect(out[1].$seen).toEqual({ system: true, messages: [true, false, false] }) // unknown ref counts as unseen
    expect(out[2].$seen).toBeUndefined() // bare record has no request
  })

  it('filters by period but resolves refs across the whole file', async () => {
    const day15 = { start: Date.parse('2026-07-15T00:00:00.000Z'), end: Date.parse('2026-07-15T23:59:59.999Z') }
    const out = await new RequestFile('sess-1', dir).read(day15)
    expect(out.map(r => r.timestamp)).toEqual(['2026-07-15T10:00:00.000Z', '2026-07-15T11:00:00.000Z'])
    expect(out[0].request.system).toEqual(system) // $ref target lives in the filtered-out day-14 record
  })

  it('returns [] when no log exists for the session', async () => {
    expect(await new RequestFile('no-such-session', dir).read()).toEqual([])
  })
})

const reminder = `<system-reminder>
As you answer the user's questions, you can use the following context:
# claudeMd
Codebase and user instructions are shown below.

Contents of C:\\Users\\me\\.claude\\CLAUDE.md (user's private global instructions for all projects):

# Personal preferences

- Keep it simple.

Contents of D:\\proj\\CLAUDE.md (project instructions, checked into the codebase):

# CLAUDE.md

Body with its own # headings.

Contents of C:\\Users\\me\\.claude\\projects\\p\\memory\\MEMORY.md (user's auto-memory, persists across conversations):

# Memory index

- [Some fact](fact.md)
# userEmail
me@example.com
# currentDate
Today's date is 2026-07-17.

      IMPORTANT: this context may or may not be relevant to your tasks.
</system-reminder>`

describe('parseClaudeMd', () => {
  it('extracts each file with a short memory_type, stopping at the next reminder key', () => {
    const files = parseClaudeMd(reminder)
    expect(files.map(f => [f.file_path, f.memory_type])).toEqual([
      ['C:\\Users\\me\\.claude\\CLAUDE.md', 'User'],
      ['D:\\proj\\CLAUDE.md', 'Project'],
      ['C:\\Users\\me\\.claude\\projects\\p\\memory\\MEMORY.md', 'Auto'],
    ])
    expect(files[0].content).toBe('# Personal preferences\n\n- Keep it simple.')
    expect(files[1].content).toBe('# CLAUDE.md\n\nBody with its own # headings.')
    expect(files[2].content).toBe('# Memory index\n\n- [Some fact](fact.md)') // # userEmail is not part of the file
  })

  it('returns [] when there is no claudeMd section', () => {
    expect(parseClaudeMd('<system-reminder>\n# gitStatus\nclean\n</system-reminder>')).toEqual([])
  })
})

describe('RequestFile.readInstructions', () => {
  it('collects the system prompt and unique memory files across all requests', async () => {
    const withReminder = (ts, system) => ({ type: 'api-request', timestamp: ts, url: 'POST /v1/messages', status: 200,
      request: { model: 'claude-sonnet-5', ...(system && { system }), messages: [{ $hash: `h-${ts}`, value: { role: 'user', content: [{ type: 'text', text: reminder }] } }] } })
    fs.writeFileSync(path.join(dir, 'sess-2.requests.jsonl'), [
      JSON.stringify(withReminder('2026-07-14T10:00:00.000Z', { $hash: 'sys1', value: 'Be terse' })),
      JSON.stringify(withReminder('2026-07-15T10:00:00.000Z', { $ref: 'sys1' })), // e.g. a subagent request repeating the same files
    ].join('\n') + '\n')
    const files = await new RequestFile('sess-2', dir).readInstructions()
    expect(files.map(f => f.file_path)).toEqual([
      'System prompt', 'C:\\Users\\me\\.claude\\CLAUDE.md', 'D:\\proj\\CLAUDE.md', 'C:\\Users\\me\\.claude\\projects\\p\\memory\\MEMORY.md',
    ])
    expect(files[0]).toMatchObject({ memory_type: 'claude-sonnet-5', content: 'Be terse', hash: 'sys1' })
    expect(files.every(f => f.type === 'instructions-loaded' && f.origin === 'request')).toBe(true)
    expect(files.every(f => f.timestamp === '2026-07-14T10:00:00.000Z')).toBe(true) // first sight wins
  })

  it('joins block-array system prompts into one text', async () => {
    const files = await new RequestFile('sess-1', dir).readInstructions()
    expect(files).toEqual([{ type: 'instructions-loaded', origin: 'request', timestamp: '2026-07-14T10:00:00.000Z',
      file_path: 'System prompt', memory_type: 'claude-sonnet-5', content: 'You are Claude Code', hash: 'aaa' }])
  })

  it('returns [] when no log exists', async () => {
    expect(await new RequestFile('no-such-session', dir).readInstructions()).toEqual([])
  })
})
