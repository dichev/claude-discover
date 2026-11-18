// src/main/services/UsageInsights.js: /usage's transcript scan, refetched once an hour at most
import { describe, it, expect, vi, afterEach } from 'vitest'
import { UsageInsights } from '../src/main/services/UsageInsights.js'

afterEach(() => vi.useRealTimers())

describe('UsageInsights', () => {
  it('scans on the first ask, then only once the last scan is an hour old', async () => {
    vi.useFakeTimers()
    const runner = { usage: vi.fn(async () => ({ behaviors: { day: {}, week: {} } })) }
    const insights = new UsageInsights(runner)
    expect(await insights.get()).toEqual({ at: Date.now(), day: {}, week: {} })
    expect(runner.usage).toHaveBeenCalledWith({ behaviors: true })
    vi.advanceTimersByTime(59 * 60_000)
    await insights.get()
    expect(runner.usage).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    await insights.get()
    expect(runner.usage).toHaveBeenCalledTimes(2)
  })

  it('rescans when forced, as on a page reload', async () => {
    const runner = { usage: vi.fn(async () => ({ behaviors: null })) }
    const insights = new UsageInsights(runner)
    await insights.get()
    await insights.get({ force: true })
    expect(runner.usage).toHaveBeenCalledTimes(2)
  })

  it('is null when the experimental call fails', async () => {
    expect(await new UsageInsights({ usage: async () => { throw new Error('unknown control request') } }).get()).toBeNull()
  })
})
