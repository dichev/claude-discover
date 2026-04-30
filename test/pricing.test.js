import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { costUSD, pricing, refreshPricesFromLiteLLM } from '../electron/services/Pricing.js'

describe('priceFor', () => {
  it('matches a known model exactly', () => {
    expect(pricing.priceFor('claude-opus-4-7')).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 })
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
    const cost = costUSD({
      'claude-opus-4-7': { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000 },
    })
    expect(cost).toBeCloseTo(36.75, 6) // 5 + 25 + 0.5 + 6.25
  })

  it('skips unknown models, prices known ones', () => {
    expect(costUSD({
      'gpt-5': { input: 9_999_999, output: 0, cacheRead: 0, cacheCreation: 0 },
      'claude-haiku-4-5': { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
    })).toBeCloseTo(1, 6)
  })

  it('returns null when nothing is priced', () => {
    expect(costUSD(null)).toBeNull()
    expect(costUSD({})).toBeNull()
    expect(costUSD({ 'gpt-5': { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 } })).toBeNull()
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
    await refreshPricesFromLiteLLM()
    expect(fs.existsSync(CURRENT_PATH)).toBe(true)
    const opus = pricing.priceFor('claude-opus-4-7') || pricing.priceFor('claude-opus-4-5')
    expect(opus?.input).toBeGreaterThan(0)
    expect(opus?.output).toBeGreaterThan(0)
    expect(opus?.cacheRead).toBeGreaterThan(0)
    expect(opus?.cacheWrite).toBeGreaterThan(0)
  }, 20_000)
})
