// MetaCache is pure policy over an injected `parse(range)` — no fs involved. These tests
// pin the cross-period behaviors (reuse a contained meta without parsing, skip disjoint
// files, ranged re-parse only for period-straddling files, invalidation on file growth)
// and the period layer (setPeriod scoping, byId lookup, eviction, stale-scan writes).
import { describe, it, expect } from 'vitest'
import { MetaCache } from '../src/main/sessions/MetaCache.js'

const day = { start: 1000, end: 2000, key: 'day|A' }
const stat = { size: 10, mtimeMs: 111 }

// a cache with `day` as its active period — resolve only writes the period layer for the active key
function newCache(key = day.key) {
  const cache = new MetaCache()
  cache.setPeriod(key)
  return cache
}

// parse stub that records the ranges it was called with
function parser(startedAt, lastActivityAt, sessionId = 's1') {
  const calls = []
  const parse = range => { calls.push(range); return { sessionId, startedAt, lastActivityAt, ranged: range != null } }
  return { calls, parse }
}

describe('MetaCache.resolve', () => {
  it('parses the whole file once, then serves contained periods from cache', async () => {
    const cache = newCache()
    const { calls, parse } = parser(1200, 1800) // fully inside `day`
    const first = await cache.resolve('a.jsonl', stat, day, parse)
    const second = await cache.resolve('a.jsonl', stat, day, parse)
    expect(first).toMatchObject({ startedAt: 1200, lastActivityAt: 1800, ranged: false })
    expect(second).toBe(first)
    expect(calls).toEqual([null]) // one unranged parse, no ranged ones
  })

  it('returns null for periods the session does not touch, without re-parsing', async () => {
    const cache = newCache()
    const { calls, parse } = parser(3000, 4000) // after `day`
    expect(await cache.resolve('a.jsonl', stat, day, parse)).toBe(null)
    expect(await cache.resolve('a.jsonl', stat, day, parse)).toBe(null)
    expect(calls).toEqual([null])
  })

  it('falls back to a ranged parse for files straddling a period edge', async () => {
    const cache = newCache()
    const { calls, parse } = parser(500, 1500) // starts before `day`, ends inside
    expect(await cache.resolve('a.jsonl', stat, day, parse)).toMatchObject({ ranged: true })
    expect(calls).toEqual([null, day])
  })

  it('re-parses when the file grows (size or mtime changed)', async () => {
    const cache = newCache()
    const { calls, parse } = parser(1200, 1800)
    await cache.resolve('a.jsonl', stat, day, parse)
    await cache.resolve('a.jsonl', { size: 20, mtimeMs: 222 }, day, parse)
    expect(calls).toEqual([null, null])
  })
})

describe('MetaCache period layer', () => {
  it('resolve records the meta, readable via get/byId/values', async () => {
    const cache = newCache()
    const meta = await cache.resolve('a.jsonl', stat, day, parser(1200, 1800).parse)
    expect(cache.get('a.jsonl')).toBe(meta)
    expect(cache.byId('s1')).toBe(meta)
    expect([...cache.values()]).toEqual([meta])
  })

  it('setPeriod clears the period layer but keeps whole-file metas', async () => {
    const cache = newCache()
    const { calls, parse } = parser(1200, 1800)
    await cache.resolve('a.jsonl', stat, day, parse)
    cache.setPeriod('day|B')
    expect([...cache.values()]).toEqual([])
    expect(cache.byId('s1')).toBe(undefined)
    cache.setPeriod(day.key)
    await cache.resolve('a.jsonl', stat, day, parse)
    expect(calls).toEqual([null]) // no re-parse — whole-file meta survived the period changes
    cache.setPeriod(day.key) // same key → no-op
    expect([...cache.values()]).toHaveLength(1)
  })

  it('a stale scan (period no longer active) returns the meta but never writes the layer', async () => {
    const cache = newCache('day|B') // `day` is not the active period
    const meta = await cache.resolve('a.jsonl', stat, day, parser(1200, 1800).parse)
    expect(meta).toMatchObject({ startedAt: 1200 }) // still resolved (and whole-file meta cached)
    expect([...cache.values()]).toEqual([])
    const { calls, parse } = parser(1200, 1800)
    cache.setPeriod(day.key)
    await cache.resolve('a.jsonl', stat, day, parse)
    expect(calls).toEqual([]) // the stale resolve still warmed the whole-file layer
    expect([...cache.values()]).toHaveLength(1)
  })

  it('clear drops both layers, forcing re-parses', async () => {
    const cache = newCache()
    const { calls, parse } = parser(1200, 1800)
    await cache.resolve('a.jsonl', stat, day, parse)
    cache.clear()
    expect([...cache.values()]).toEqual([])
    await cache.resolve('a.jsonl', stat, day, parse)
    expect(calls).toEqual([null, null]) // whole-file meta gone too
  })

  it('evict forgets the file entirely', async () => {
    const cache = newCache()
    const { calls, parse } = parser(1200, 1800)
    await cache.resolve('a.jsonl', stat, day, parse)
    expect(cache.evict('a.jsonl')).toBe(true)
    expect(cache.byId('s1')).toBe(undefined)
    expect(cache.evict('a.jsonl')).toBe(false) // already gone
    await cache.resolve('a.jsonl', stat, day, parse)
    expect(calls).toEqual([null, null]) // evict forced a re-parse
  })
})
