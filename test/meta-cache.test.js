// MetaCache is pure policy over an injected `parse(range)` — no fs involved. These tests
// pin the cross-period behaviors: reuse a contained meta without parsing, skip disjoint
// files, ranged re-parse only for period-straddling files, invalidation on file growth.
import { describe, it, expect } from 'vitest'
import { MetaCache } from '../src/main/sessions/MetaCache.js'

const day = { start: 1000, end: 2000 }
const stat = { size: 10, mtimeMs: 111 }

// parse stub that records the ranges it was called with
function parser(startedAt, lastActivityAt, sessionId = 's1') {
  const calls = []
  const parse = range => { calls.push(range); return { sessionId, startedAt, lastActivityAt, ranged: range != null } }
  return { calls, parse }
}

describe('MetaCache.resolve', () => {
  it('parses the whole file once, then serves contained periods from cache', async () => {
    const cache = new MetaCache()
    const { calls, parse } = parser(1200, 1800) // fully inside `day`
    const first = await cache.resolve('a.jsonl', stat, day, parse)
    const second = await cache.resolve('a.jsonl', stat, { start: 0, end: 5000 }, parse)
    expect(first).toMatchObject({ startedAt: 1200, lastActivityAt: 1800, ranged: false })
    expect(second).toBe(first)
    expect(calls).toEqual([null]) // one unranged parse, no ranged ones
  })

  it('returns null for periods the session does not touch, without re-parsing', async () => {
    const cache = new MetaCache()
    const { calls, parse } = parser(3000, 4000) // after `day`
    expect(await cache.resolve('a.jsonl', stat, day, parse)).toBe(null)
    expect(await cache.resolve('a.jsonl', stat, day, parse)).toBe(null)
    expect(calls).toEqual([null])
  })

  it('falls back to a ranged parse for files straddling a period edge', async () => {
    const cache = new MetaCache()
    const { calls, parse } = parser(500, 1500) // starts before `day`, ends inside
    expect(await cache.resolve('a.jsonl', stat, day, parse)).toMatchObject({ ranged: true })
    expect(calls).toEqual([null, day])
  })

  it('re-parses when the file grows (size or mtime changed)', async () => {
    const cache = new MetaCache()
    const { calls, parse } = parser(1200, 1800)
    await cache.resolve('a.jsonl', stat, day, parse)
    await cache.resolve('a.jsonl', { size: 20, mtimeMs: 222 }, day, parse)
    expect(calls).toEqual([null, null])
  })

  it('shares one parse between scans running together', async () => {
    const cache = new MetaCache()
    const { calls, parse } = parser(1200, 1800)
    await Promise.all([cache.resolve('a.jsonl', stat, day, parse), cache.resolve('a.jsonl', stat, { start: 0, end: 5000 }, parse)])
    expect(calls).toEqual([null])
  })

  it('clear and evict force a re-parse', async () => {
    const cache = new MetaCache()
    const { calls, parse } = parser(1200, 1800)
    await cache.resolve('a.jsonl', stat, day, parse)
    cache.clear()
    await cache.resolve('a.jsonl', stat, day, parse)
    cache.evict('a.jsonl')
    await cache.resolve('a.jsonl', stat, day, parse)
    expect(calls).toEqual([null, null, null])
  })
})
