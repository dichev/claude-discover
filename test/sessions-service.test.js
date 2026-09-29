// Watched-mode update emits: each is tagged with its period (the renderer drops other periods'),
// and a snapshot whose dedup finishes after a newer one's is never sent.
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
