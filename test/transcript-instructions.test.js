// Reading the loop's instruction strips off the transcript's own request records (src/main/requests/TranscriptInstructions.js).
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TranscriptInstructions } from '../src/main/requests/TranscriptInstructions.js'
import { SessionsService } from '../src/main/services/SessionsService.js'

const system = [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }]
const read   = { name: 'Read', description: 'reads' }
const claudeMd = { role: 'user', content: [{ type: 'text', text: '<system-reminder>\nCodebase and user instructions are shown below.\n\nContents of D:\\proj\\CLAUDE.md (project instructions, checked into the codebase):\n\n# CLAUDE.md\n\nBe brief.\n</system-reminder>' }, { type: 'text', text: 'hey' }] }
const added  = { role: 'system', content: [{ type: 'text', text: '<system-reminder>\nTools added\n</system-reminder>' }] }
const request = (id, timestamp, extra = {}) => ({ type: 'api-request', id, timestamp, querySource: 'repl_main_thread', params: { model: 'claude-opus-5-5' }, keep: 0, tail: [], ...extra })

const lines = [
  { type: 'user', timestamp: '2026-10-17T10:00:00.000Z', message: { role: 'user', content: 'hey' } },
  { type: 'api-request-shape', shapeHash: 's1', timestamp: '2026-10-17T10:00:00.300Z', shape: { system, tools: [read] } },
  { type: 'api-request-blob', hash: 'b1', message: claudeMd },
  request('r1', '2026-10-17T10:00:00.300Z'),
  { type: 'assistant', timestamp: '2026-10-17T10:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Hey!' }] } },
  { type: 'api-request-blob', hash: 'b2', message: added },
  request('r2', '2026-10-17T10:01:00.000Z', { base: 'r1', keep: 1, tail: ['reply', 'prompt', 'b2'] }),
  { type: 'api-request-shape', shapeHash: 's2', timestamp: '2026-10-17T10:02:00.000Z', shape: { system, tools: [read, { name: 'mcp__docs__read', description: 'docs' }] } },
  request('r3', '2026-10-17T10:02:00.000Z', { base: 'r2' }),
]

describe('TranscriptInstructions', () => {
  it('emits what each request first sent, at its timestamp, as the loop\'s own', () => {
    const transcript = new TranscriptInstructions()
    const strips = lines.flatMap(l => transcript.feed(l))
    expect(strips.map(s => [s.timestamp, s.file_path, s.memory_type])).toEqual([
      ['2026-10-17T10:00:00.300Z', 'System Prompt', ''],
      ['2026-10-17T10:00:00.300Z', 'System Tools', '1 tool'],
      ['2026-10-17T10:00:00.300Z', 'D:\\proj\\CLAUDE.md', 'Project'],
      ['2026-10-17T10:01:00.000Z', 'Tools added', 'system-reminder'],
      ['2026-10-17T10:02:00.000Z', 'MCP Tools', '1 tool'], // an unchanged prompt isn't listed again
    ])
    expect(strips.filter(s => s.kind).every(s => s.kind === 'main')).toBe(true)
  })

  it('emits nothing for lines other than a request', () => {
    const transcript = new TranscriptInstructions()
    expect(lines.slice(0, 3).flatMap(l => transcript.feed(l))).toEqual([])
  })

  it('tells an attachment whose injected text the strips already list from one they don\'t', () => {
    const transcript = new TranscriptInstructions()
    const keys = new Set(lines.flatMap(l => transcript.feed(l)).map(s => s.hash))
    const attachment = text => ({ type: 'attachment', rendered: [{ content: text }] })
    expect(TranscriptInstructions.listed(attachment(claudeMd.content[0].text), keys)).toBe(true) // its one memory file
    expect(TranscriptInstructions.listed(attachment('<system-reminder>\nTools added\n</system-reminder>'), keys)).toBe(true)
    expect(TranscriptInstructions.listed(attachment("<system-reminder>\nToday's date is 2026-10-17.\n</system-reminder>"), keys)).toBe(false)
    expect(TranscriptInstructions.listed({ type: 'attachment' }, keys)).toBe(false) // nothing injected
    expect(TranscriptInstructions.listed({ type: 'attachment', attachment: { type: 'prompt_snapshot' } }, keys)).toBe(true)
  })

  it('lists a memory file again once its content changed, and its new text is not listed yet', () => {
    const transcript = new TranscriptInstructions()
    const edited = claudeMd.content[0].text.replace('Be brief.', 'Be thorough.')
    const keys = new Set(lines.flatMap(l => transcript.feed(l)).map(s => s.hash))
    expect(TranscriptInstructions.listed({ type: 'attachment', rendered: [{ content: edited }] }, keys)).toBe(false)
    const strips = [{ type: 'api-request-blob', hash: 'b3', message: { role: 'user', content: [{ type: 'text', text: edited }] } }, request('r4', '2026-10-17T10:03:00.000Z')]
      .flatMap(l => transcript.feed(l))
    expect(strips.map(s => [s.file_path, s.content])).toEqual([['D:\\proj\\CLAUDE.md', '# CLAUDE.md\n\nBe thorough.']])
  })
})

describe('SessionsService.readSession — the loop\'s strips', () => {
  let dir
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-loop-')) })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('shows what the conversation started with on a later day too, above that day\'s own', async () => {
    const day2 = [
      { type: 'user', uuid: 'u2', timestamp: '2026-10-18T10:00:00.000Z', message: { role: 'user', content: 'more' } },
      { type: 'api-request-blob', hash: 'b2', message: added },
      request('r2', '2026-10-18T10:00:00.300Z', { base: 'r1' }),
    ]
    const file = path.join(dir, `${crypto.randomUUID()}.jsonl`)
    fs.writeFileSync(file, [...lines.slice(0, 4), ...day2].map(l => JSON.stringify(l)).join('\n') + '\n')
    const service = new SessionsService({ root: dir })
    service.metaCache.periodMetas.set(file, { filePath: file, mtime: Date.now() })
    const { instructions } = await service.readSession(file, '2026-10-18', 'day')
    expect(instructions.loop.map(s => s.file_path)).toEqual(['System Prompt', 'System Tools', 'D:\\proj\\CLAUDE.md', 'Tools added'])
  })
})
