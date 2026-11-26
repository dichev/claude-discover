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

const line = (uuid, timestamp) => JSON.stringify({ type: 'user', uuid, sessionId: 's1', cwd: '/proj', timestamp, message: { role: 'user', content: 'hi' } }) + '\n'
const sent = service => new Promise(resolve => service.once('update', resolve))

// A service watching March as the window does, over one transcript with a prompt typed on the 1st: `sessions` are what it was sent
async function watchingMarch() {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'watched-')), 'proj', 's1.jsonl')
  await fs.mkdir(path.dirname(file))
  await fs.writeFile(file, line('u1', '2026-03-01T10:00:00.000Z'))
  const service = new SessionsService({ root: path.dirname(path.dirname(file)), throttleMs: 0 })
  service.list('2026-03-01', 'month')
  return { service, file, ...await sent(service) }
}

// The window is hidden in the tray: nothing is parsed for a period nobody sees, and it's fresh again once someone does
describe('SessionsService.pause', () => {
  it('leaves a change unparsed, then catches up on resume and sends the period afresh', async () => {
    const { service, file, sessions } = await watchingMarch()
    expect(sessions).toMatchObject([{ messageCount: 1 }])

    service.pause()
    await fs.appendFile(file, line('u2', '2026-03-02T10:00:00.000Z'))
    await service._refresh(file, await fs.stat(file)) // what the watcher calls on the append
    expect(service.periodMetas.get(file).messageCount).toBe(1)

    const update = sent(service)
    service.resume()
    expect((await update).sessions).toMatchObject([{ messageCount: 2 }])
  })
})

// What the window is on stays its own, whatever is asked of the reader beside it or still arriving from where it was
describe('SessionsService watched period', () => {
  it('is left as it is by the reader\'s scans of any period, running together', async () => {
    const { service, file } = await watchingMarch()
    const march = { start: Date.parse('2026-03-01'), end: Date.parse('2026-04-01') }
    const april = { start: Date.parse('2026-04-02'), end: Date.parse('2026-05-01') }
    const [inMarch, inApril] = await Promise.all([service.reader.scan(march), service.reader.scan(april)])
    expect(inMarch).toMatchObject([{ messageCount: 1 }])
    expect(inApril).toEqual([])
    expect(service.activeDay).toMatchObject({ date: '2026-03-01', granularity: 'month' })
    expect([...service.periodMetas.keys()]).toEqual([file])
  })

  it('takes no meta from a scan of the period it has left, and drops its own on moving to another', async () => {
    const { service, file } = await watchingMarch()
    const stat  = await fs.stat(file)
    const march = service.activeDay
    service.list('2026-04-01', 'month')
    expect(service.periodMetas.size).toBe(0)
    expect(await service._processFile(file, march, stat)).toMatchObject({ messageCount: 1 }) // still answered, from the reader's whole-file meta
    expect(service.periodMetas.size).toBe(0)
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

  it('reads another file whole beside it, leaving the opened one open', async () => {
    const service = new SessionsService({ scanner: {} })
    const opened  = await write('shared.jsonl', JSON.stringify(lines[0]) + '\n')
    const other   = await write('other.jsonl', lines.map(l => JSON.stringify(l)).join('\n') + '\n')
    await service.openFile(opened)
    const read = await service.reader.readFile(other)
    expect(read.meta).toMatchObject({ filePath: other, messageCount: 2 })
    expect(read.items.map(o => o.uuid)).toEqual(['u1', 'a1'])
    expect((await service.readSession(opened)).items.map(o => o.uuid)).toEqual(['u1'])
  })

  it('sorts an untimestamped line by its neighbours in the file, not the file time', async () => {
    const service = new SessionsService({ scanner: {} })
    const mode = permissionMode => ({ type: 'permission-mode', permissionMode, sessionId: 'shared' })
    const file = await write('shared.jsonl', [mode('default'), lines[0], mode('plan'), lines[1]].map(l => JSON.stringify(l)).join('\n') + '\n')
    await service.openFile(file)
    const { items } = await service.readSession(file)
    expect(items.map(o => o.uuid ?? o.permissionMode)).toEqual(['default', 'u1', 'plan', 'a1'])
  })

  it('refuses a file with no Claude Code messages', async () => {
    const service = new SessionsService({ scanner: {} })
    await expect(service.openFile(await write('notes.jsonl', '{"a":1}\n'))).rejects.toThrow(/No Claude Code messages/)
    await expect(service.openFile(await write('notes.txt', 'hi'))).rejects.toThrow(/Not a \.jsonl/)
  })
})
