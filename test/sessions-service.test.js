// Watched-mode update emits: each is tagged with its period (the renderer drops other periods'),
// and a snapshot whose dedup finishes after a newer one's is never sent.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { SessionsService } from '../src/main/services/SessionsService.js'

describe('SessionsService update emits', () => {
  it('drops a snapshot overtaken by a newer one and tags the rest with their period', async () => {
    const service = new SessionsService({ scanner: {}, throttleMs: 0 })
    service.activeDay = { date: '2026-09-01', granularity: 'month', key: 'month|2026-09-01' }
    const pending = []
    service._dedupedDay = () => new Promise(resolve => pending.push(resolve))
    const emitted = []
    service.on('update', u => emitted.push(u))

    service._scheduleUpdate() // older snapshot
    service._scheduleUpdate() // newer snapshot
    expect(pending).toHaveLength(2)
    pending[1](['new'])
    pending[0](['old']) // older dedup finishes last
    await new Promise(r => setTimeout(r))

    expect(emitted).toEqual([{ date: '2026-09-01', granularity: 'month', sessions: ['new'] }])
  })

  it('still sends overlapping snapshots that finish in order', async () => {
    const service = new SessionsService({ scanner: {}, throttleMs: 0 })
    service.activeDay = { date: '2026-09-01', granularity: 'month', key: 'month|2026-09-01' }
    const pending = []
    service._dedupedDay = () => new Promise(resolve => pending.push(resolve))
    const emitted = []
    service.on('update', u => emitted.push(u.sessions))

    service._scheduleUpdate()
    service._scheduleUpdate() // starts before the first finishes, as with steady writes and a slow dedup
    pending[0](['first'])
    await new Promise(r => setTimeout(r))
    pending[1](['second'])
    await new Promise(r => setTimeout(r))

    expect(emitted).toEqual([['first'], ['second']])
  })
})

// A transcript someone sent over, outside the projects dir: read whole, with no period
describe('SessionsService.openFile', () => {
  const lines = [
    { type: 'user', uuid: 'u1', sessionId: 'shared', cwd: '/elsewhere/proj', timestamp: '2026-03-01T10:00:00.000Z', message: { role: 'user', content: 'hi' } },
    { type: 'assistant', uuid: 'a1', sessionId: 'shared', timestamp: '2026-03-02T10:00:00.000Z', message: { id: 'm1', role: 'assistant', model: 'claude-opus-5', usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: 'text', text: 'hello' }] } },
  ]
  const write = async (name, content) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-file-'))
    const file = path.join(dir, name)
    await fs.writeFile(file, content)
    return file
  }

  it('reads the whole file and serves it to readSession', async () => {
    const service = new SessionsService({ scanner: {} })
    const file = await write('shared.jsonl', lines.map(l => JSON.stringify(l)).join('\n') + '\n')
    const meta = await service.openFile(file)
    expect(meta).toMatchObject({ sessionId: 'shared', filePath: file, messageCount: 2, projectShort: 'proj', tokens: { input: 100, output: 10 } })
    expect(meta.seenMessageIds).toBeUndefined()
    const { items } = await service.readSession(file)
    expect(items.map(o => o.uuid)).toEqual(['u1', 'a1'])
  })

  it('refuses a file with no Claude Code messages', async () => {
    const service = new SessionsService({ scanner: {} })
    await expect(service.openFile(await write('notes.jsonl', '{"a":1}\n'))).rejects.toThrow(/No Claude Code messages/)
    await expect(service.openFile(await write('notes.txt', 'hi'))).rejects.toThrow(/Not a \.jsonl/)
  })
})
