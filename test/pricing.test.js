import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pricing } from '../src/main/services/Pricing.js'

const pricing = new Pricing()

describe('priceFor', () => {
  it('matches a known model exactly', () => {
    expect(pricing.priceFor('claude-opus-4-7')).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10, fastModeMplr: 6 })
  })

  it('prefers the longest matching prefix', () => {
    expect(pricing.priceFor('claude-opus-4-7-20260101').input).toBe(5)
    expect(pricing.priceFor('claude-opus-4').input).toBe(15)
  })

  it('returns null for unknown / empty', () => {
    expect(pricing.priceFor('gpt-5')).toBeNull()
    expect(pricing.priceFor(null)).toBeNull()
    expect(pricing.priceFor('')).toBeNull()
  })
})

describe('costForDelta', () => {
  it('matches costUSD when summed across models', () => {
    const byModel = {
      'claude-opus-4-7':  { input: 500_000, output: 200_000, cacheRead: 1_000_000, cacheCreation: 300_000 },
      'claude-haiku-4-5': { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
    }
    const summed = Object.entries(byModel).reduce((a, [m, b]) => a + (pricing.costForDelta(m, b) || 0), 0)
    expect(summed).toBeCloseTo(pricing.costUSD(byModel), 6)
  })

  it('returns null for unpriced model', () => {
    expect(pricing.costForDelta('gpt-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 })).toBeNull()
  })
})

describe('costUSD', () => {
  it('sums input/output/cacheRead/cacheCreation rates', () => {
    const cost = pricing.costUSD({
      'claude-opus-4-7': { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000 },
    })
    expect(cost).toBeCloseTo(36.75, 6) // 5 + 25 + 0.5 + 6.25 (unknown TTL → 5m rate)
  })

  it('applies 1h rate to cacheCreation1h tokens', () => {
    const cost = pricing.costUSD({
      'claude-opus-4-7': { input: 0, output: 0, cacheRead: 0, cacheCreation: 2_000_000, cacheCreation5m: 1_000_000, cacheCreation1h: 1_000_000 },
    })
    expect(cost).toBeCloseTo(16.25, 6) // 1M * 6.25 + 1M * 10
  })

  it('skips unknown models, prices known ones', () => {
    expect(pricing.costUSD({
      'gpt-5': { input: 9_999_999, output: 0, cacheRead: 0, cacheCreation: 0 },
      'claude-haiku-4-5': { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
    })).toBeCloseTo(1, 6)
  })

  it('returns null when nothing is priced', () => {
    expect(pricing.costUSD(null)).toBeNull()
    expect(pricing.costUSD({})).toBeNull()
    expect(pricing.costUSD({ 'gpt-5': { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 } })).toBeNull()
  })
})

describe('fast mode', () => {
  const bucket = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000 }

  it('reads the per-model fast multiplier, null when absent', () => {
    expect(pricing.fastMultiplier('claude-opus-4-8')).toBe(2)
    expect(pricing.fastMultiplier('claude-opus-4-7')).toBe(6)
    expect(pricing.fastMultiplier('claude-sonnet-4-6')).toBeNull()
    expect(pricing.fastMultiplier('gpt-5')).toBeNull()
  })

  it('scales the standard cost by the multiplier when fast', () => {
    const std = pricing.costForDelta('claude-opus-4-8', bucket)
    expect(pricing.costForDelta('claude-opus-4-8', bucket, { fast: true })).toBeCloseTo(std * 2, 6)
  })

  it('falls back to 1x when fast but no multiplier is known', () => {
    // claude-opus-4-5 has no fastModeMplr in the table
    expect(pricing.fastMultiplier('claude-opus-4-5')).toBeNull()
    const std = pricing.costForDelta('claude-opus-4-5', bucket)
    expect(pricing.costForDelta('claude-opus-4-5', bucket, { fast: true })).toBeCloseTo(std, 6)
  })
})

const here = path.dirname(fileURLToPath(import.meta.url))
const CURRENT_PATH = path.resolve(here, '../cache/prices.current.json')

describe('refreshPricesFromLiteLLM (live)', () => {
  let backup = null
  beforeAll(() => {
    if (fs.existsSync(CURRENT_PATH)) {
      backup = fs.readFileSync(CURRENT_PATH, 'utf8')
      fs.unlinkSync(CURRENT_PATH)
    }
  })
  afterAll(() => {
    if (backup != null) fs.writeFileSync(CURRENT_PATH, backup)
  })

  it('fetches and writes cache/prices.current.json with usable rates', async () => {
    await pricing.refreshFromLiteLLM()
    expect(fs.existsSync(CURRENT_PATH)).toBe(true)
    const opus = pricing.priceFor('claude-opus-4-7') || pricing.priceFor('claude-opus-4-5')
    expect(opus?.input).toBeGreaterThan(0)
    expect(opus?.output).toBeGreaterThan(0)
    expect(opus?.cacheRead).toBeGreaterThan(0)
    expect(opus?.cacheWrite).toBeGreaterThan(0)
  }, 20_000)
})
