import { describe, expect, it } from 'vitest'
import { contextAt, rowUntil } from '../src/renderer/sessions/context/contextParts.js'
import { totalsBy } from '../src/renderer/sessions/context/totalsBy.js'

const system  = uuid => ({ uuid, role: 'system', blocks: [] })
const user    = uuid => ({ uuid, role: 'user', blocks: [{ type: 'text', text: uuid }] })
const reply   = (uuid, input) => ({ uuid, role: 'assistant', usage: { input_tokens: input }, blocks: [{ type: 'text', text: 'done' }] })
const compact = (uuid, preTokens) => ({ uuid, role: 'compact', blocks: [{ summary: 'what came before', preTokens }] })

describe('contextAt', () => {
  const turns = [system('s'), user('u1'), reply('r1', 400), user('u2'), reply('r2', 900), compact('c', 5000), user('u3'), reply('r3', 300), user('u4')]
  const at    = row => contextAt(turns, row)

  it('reads a row at the next request, which holds it', () => {
    expect(at('s')).toEqual({ turns: turns.slice(0, 2), size: 400 })
    expect(at('u2')).toEqual({ turns: turns.slice(0, 4), size: 900 })
    expect(at('u3')).toEqual({ turns: turns.slice(0, 7), size: 300 })
  })

  it('reads a row before a compaction, and its own, at the context it cut', () => {
    expect(at('r2')).toEqual({ turns: turns.slice(0, 5), size: 5000 })
    expect(at('c')).toEqual({ turns: turns.slice(0, 5), size: 5000 })
  })

  it('reads a row with no request since as the context now', () => {
    expect(at('u4')).toBeNull()
    expect(at('gone')).toBeNull()
  })

  it('reads a row a rewind dropped at the last request before it, the next one no longer holding it', () => {
    const rewound = [system('s'), user('u1'), reply('r1', 400), user('u2'), reply('r2', 900), { ...user('u3'), rewind: { since: 0 } }, reply('r3', 450)]
    expect(contextAt(rewound, 'r2')).toEqual({ turns: rewound.slice(0, 5), size: 900 })
    expect(contextAt(rewound, 'u3')).toEqual({ turns: rewound.slice(0, 6), size: 450 }) // the rewind's own row: the request after it
  })

  it('reads a row the rewind kept at the request after it, which still holds it', () => {
    const timed = (t, ts) => ({ ...t, ts })
    // a prompt interrupted before its reply, then rewound
    const rewound = [timed(user('u1'), 1), timed(reply('r1', 400), 2), timed(user('u2'), 3), timed({ ...user('u3'), rewind: { since: 3 } }, 4), timed(reply('r3', 450), 5)]
    expect(contextAt(rewound, 'r1')).toEqual({ turns: rewound.slice(0, 4), size: 450 })
    expect(contextAt(rewound, 'u2')).toEqual({ turns: rewound.slice(0, 3), size: 400 })
  })
})

describe('rowUntil', () => {
  const at   = time => new Date(`2026-10-24T${time}`).getTime()
  const turn = (uuid, role, time) => ({ uuid, role, ts: at(time), blocks: [{ type: 'text', text: uuid }] })
  const turns = [turn('u1', 'user', '10:00'), turn('r1', 'assistant', '10:01'), turn('u2', 'user', '10:05'), turn('r2', 'assistant', '10:06')]

  it('ends a row when the next one starts, and the last one not at all', () => {
    expect(rowUntil(turns, 'u1')).toBe(at('10:01'))
    expect(rowUntil(turns, 'r1')).toBe(at('10:05'))
    expect(rowUntil(turns, 'r2')).toBeNull()
  })

  it('reads a compaction before it', () => {
    const compacted = [...turns.slice(0, 2), turn('c', 'compact', '10:03'), ...turns.slice(2)]
    expect(rowUntil(compacted, 'c')).toBe(at('10:03'))
  })
})

describe('totalsBy', () => {
  const usage = (input, cacheRead, cacheCreation) => ({ input, output: 0, cacheRead, cacheCreation, cacheCreation5m: cacheCreation, cacheCreation1h: 0 })
  const meta = {
    cost: 3, totalTokens: 300, activeMs: 50,
    costSamples: [{ end: 10, cost: 1, tokens: 100, usage: usage(10, 60, 30) }, { end: 20, cost: 2, tokens: 200, usage: usage(20, 180, 0) }],
    serverToolSamples: [{ end: 15, webSearch: 1, webFetch: 2 }],
    activityPeriods: [{ start: 0, end: 15 }, { start: 30, end: 65 }],
  }

  it('adds up what was spent before the time, clipping the active period it falls in', () => {
    expect(totalsBy(meta, 12)).toEqual({
      cost: 1, totalTokens: 100, tokens: usage(10, 60, 30), cacheHitRatio: 60 / 90, serverToolUse: { webSearch: 0, webFetch: 0 }, activeMs: 12,
    })
    expect(totalsBy(meta, 40)).toMatchObject({ cost: 3, totalTokens: 300, tokens: { cacheRead: 240 }, activeMs: 25 })
    expect(totalsBy(meta, 40).serverToolUse).toEqual({ webSearch: 1, webFetch: 2 })
  })

  it("gives the session's own figures by now", () => {
    expect(totalsBy(meta, null)).toBe(meta)
  })
})
