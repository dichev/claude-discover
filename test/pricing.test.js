import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pricing } from '../src/main/services/Pricing.js'

describe('priceFor', () => {
  it('matches a known model exactly', () => {
    expect(pricing.priceFor('claude-opus-4-7')).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 })
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
