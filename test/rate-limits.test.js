// src/main/services/RateLimits.js: the 5h/7d plan usage, cached over AgentRunner.usage()
import { describe, it, expect, vi } from 'vitest'
import { RateLimits } from '../src/main/services/RateLimits.js'

const runner = usage => ({ usage: vi.fn(usage) })

describe('RateLimits', () => {
  it('maps the 5h/7d windows', async () => {
    const limits = await new RateLimits(runner(async () => ({ rate_limits: {
      five_hour: { utilization: 5, resets_at: '2026-10-05T23:29:59.722733+00:00' },
      seven_day: { utilization: 26, resets_at: '2026-10-07T19:59:59+00:00' },
    } }))).get()
    expect(limits).toMatchObject({
      fiveHour: { utilization: 5, resetsAt: Date.parse('2026-10-05T23:30:00Z') },
      sevenDay: { utilization: 26, resetsAt: Date.parse('2026-10-07T20:00:00Z') },
    })
  })

  it('asks once per refresh, shared by concurrent callers and cached after', async () => {
    const r = runner(async () => ({ rate_limits: { five_hour: { utilization: 1, resets_at: null } } }))
    const rl = new RateLimits(r)
    const [a, b] = await Promise.all([rl.get(), rl.get()])
    expect(await rl.get()).toBe(a)
    expect(b).toBe(a)
    expect(r.usage).toHaveBeenCalledTimes(1)
  })

  it('is null without plan limits, or when the experimental call fails', async () => {
    expect(await new RateLimits(runner(async () => ({ rate_limits_available: false, rate_limits: null }))).get()).toBeNull()
    expect(await new RateLimits(runner(async () => { throw new Error('unknown control request') })).get()).toBeNull()
  })
})
