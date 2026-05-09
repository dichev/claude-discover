import { describe, it, expect } from 'vitest'
import { AgentRunner } from '../src/main/services/AgentRunner.js'

describe('AgentRunner.usage', () => {
  it('returns five_hour and seven_day utilizations', async () => {
    const usage = await new AgentRunner().usage()
    console.log(usage)
    expect(typeof usage.five_hour.utilization).toBe('number')
    expect(typeof usage.seven_day.utilization).toBe('number')
    expect(usage.five_hour.resets_at).toBeInstanceOf(Date)
    expect(usage.seven_day.resets_at).toBeInstanceOf(Date)
  })
})
