import { describe, expect, it } from 'vitest'
import { format } from 'date-fns'
import { eventsAt, sessionEvents } from '../src/renderer/sessions/events/sessionEvents.js'
import { flatten } from '../src/renderer/sessions/view/transcript.js'

const at      = time => new Date(`2026-10-24T${time}`).getTime()
const turn    = (uuid, role, time, rest) => ({ uuid, role, ts: at(time), blocks: [{ type: 'text', text: uuid }], ...rest })
const context = (uuid, time) => ({ uuid, role: 'user', ts: at(time), blocks: [{ type: 'attachment', folded: true, attachment: { type: 'selected_lines_in_ide' } }] })

describe('sessionEvents', () => {
  const turns = [
    turn('u1', 'user', '10:00'), turn('r1', 'assistant', '10:01'),
    { ...turn('c', 'compact', '10:30'), blocks: [{ summary: 'before', preTokens: 5000 }] },
    turn('u2', 'user', '11:00'), turn('r2', 'assistant', '11:01'),
    context('ide', '11:10'), turn('u3', 'user', '11:15', { rewind: { since: at('11:00') } }), turn('r3', 'assistant', '11:16'),
  ]
  const events = sessionEvents(turns, {})

  it('lists the start, each compaction and rewind in order, and the latest row, told by their times', () => {
    expect(events.map(e => [e.kind, e.name, e.time])).toEqual([
      ['start', 'Session start', '10:00'], ['compact', 'Compaction', '10:30'], ['rewind', 'Rewind', '11:15'], ['latest', 'Latest', '11:16'],
    ])
    expect(sessionEvents(turns, { continuesFrom: at('09:00') })[0].name).toBe('Period start')
    expect(sessionEvents([{ ...turns[0], ts: at('10:00') - 86400e3 }, ...turns.slice(1)], {})[1].time).toBe('Oct 24 10:30')
    expect(sessionEvents([], {})).toEqual([])
  })

  it('lists a /clear, an interruption, a mode, model or effort change, a return from a break and the branch point', () => {
    let n = 0
    const rec = (type, time, rest) => ({ type, uuid: `${type}${++n}`, parentUuid: null, timestamp: `2026-10-24T${time}:00.000Z`, ...rest })
    const prompt = (time, content) => rec('user', time, { message: { role: 'user', content } })
    const reply = (time, model, effort) => rec('assistant', time, { perTurnEffort: effort, message: { role: 'assistant', model, id: `m${n}`, content: [{ type: 'text', text: 'ok' }] } })
    const items = [
      prompt('10:00', 'go'), reply('10:01', 'claude-opus-5-5', 'high'),
      prompt('10:02', 'next'), reply('10:03', 'claude-opus-5-5', 'high'),
      prompt('10:04', '[Request interrupted by user]'),
      // logged untimestamped, like Claude Code does
      { type: 'permission-mode', permissionMode: 'default' }, { type: 'permission-mode', permissionMode: 'plan' },
      prompt('10:07', 'plan it'), reply('10:08', 'claude-sonnet-5-5', 'high'),
      prompt('10:09', 'think harder'), reply('10:10', 'claude-sonnet-5-5', 'max'),
      rec('system', '10:30', { subtype: 'away_summary', content: 'You asked to…' }),
      prompt('10:31', '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>'),
    ]
    const turns = flatten(items)
    const fork = { forkedFrom: { sessionId: 'abcdef123456' }, forkedAt: Date.parse('2026-10-24T10:01:30.000Z') }
    expect(sessionEvents(turns, fork).map(e => e.name).slice(1, -1)).toEqual([
      'Branched from abcdef12', 'Interrupted', 'Mode: plan', 'Model: sonnet-5-5', 'Effort: max', 'Back after a break', 'Context cleared',
    ])
    // the mode change told by the record before it
    expect(sessionEvents(turns, fork).find(e => e.kind === 'mode').time).toBe(format(Date.parse('2026-10-24T10:04:00.000Z'), 'HH:mm'))
  })

  it("jumps to a rewind's row, which starts at the context held for its prompt", () => {
    expect(events.map(e => e.at)).toEqual(['u1', 'c', 'ide', 'bottom'])
  })

  it('marks the event the row scrolled to comes after', () => {
    const marked = row => eventsAt(turns, events, row).picked?.kind
    expect(marked('u1')).toBe('start')
    expect(marked('c')).toBe('compact')
    expect(marked('r2')).toBe('compact')
    expect(marked('ide')).toBe('rewind')
    expect(marked('r3')).toBe('latest')
    expect(marked(null)).toBe('latest')
    expect(marked('gone')).toBeUndefined()
  })

  it('steps to the events either side of the row, back to the one it comes after when past it', () => {
    const steps = row => { const { earlier, later } = eventsAt(turns, events, row); return [earlier?.kind, later?.kind] }
    expect(steps('u1')).toEqual([undefined, 'compact'])
    expect(steps('c')).toEqual(['start', 'rewind'])
    expect(steps('r2')).toEqual(['compact', 'rewind'])
    expect(steps(null)).toEqual(['rewind', undefined])
  })

  it('marks by the rows, a held context turn coming before the row above its prompt', () => {
    const held = [context('ide', '10:00'), { ...turn('c', 'compact', '10:01'), blocks: [{ summary: 'before', preTokens: 5000 }] }, turn('u1', 'user', '10:02', { rewind: { since: null } }), turn('r1', 'assistant', '10:03')]
    const list = sessionEvents(held, {})
    expect(list.map(e => e.at)).toEqual(['c', 'c', 'ide', 'bottom'])
    expect(eventsAt(held, list, 'c').picked.kind).toBe('compact') // the compaction is the first row
    expect(eventsAt(held, list, 'ide').picked.kind).toBe('rewind')
  })
})
