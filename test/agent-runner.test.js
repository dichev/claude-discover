// src/main/services/AgentRunner.js usage(): one idle SDK session per call, always closed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sdk = vi.hoisted(() => ({ usage: null, close: null, query: null }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: (...args) => sdk.query(...args) }))

import { AgentRunner } from '../src/main/services/AgentRunner.js'

beforeEach(() => {
  sdk.close = vi.fn()
  sdk.query = vi.fn(() => ({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: sdk.usage, close: sdk.close }))
})
afterEach(() => vi.useRealTimers())

describe('AgentRunner.usage', () => {
  it('returns the /usage answer, skipping the transcript scan, and closes the session', async () => {
    vi.useFakeTimers()
    sdk.usage = vi.fn(async () => ({ rate_limits: null }))
    expect(await new AgentRunner().usage()).toEqual({ rate_limits: null })
    expect(sdk.usage).toHaveBeenCalledWith({ skipBehaviors: true })
    expect(sdk.close).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0) // the timeout doesn't outlive the answer
  })

  it('closes the session when the call fails', async () => {
    sdk.usage = vi.fn(async () => { throw new Error('unknown control request') })
    await expect(new AgentRunner().usage()).rejects.toThrow('unknown control request')
    expect(sdk.close).toHaveBeenCalled()
  })

  it('gives up on a session that never answers, and closes it', async () => {
    vi.useFakeTimers()
    sdk.usage = vi.fn(() => new Promise(() => {}))
    const usage = new AgentRunner().usage()
    const check = expect(usage).rejects.toThrow('timed out after 30s')
    await vi.advanceTimersByTimeAsync(30_000)
    await check
    expect(sdk.close).toHaveBeenCalled()
  })
})
