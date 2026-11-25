import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../src/main/paths.js'
import { Pricing } from '../src/main/services/Pricing.js'
import { SessionParser } from '../src/main/sessions/SessionParser.js'
import seed from '../src/main/config/prices.seed.json' with { type: 'json' }

// pinned to the committed seed — a live prices.current.json would make these assertions machine-dependent
const pricing = new Pricing()
pricing.prices = seed

describe('priceFor', () => {
  it('matches a known model exactly', () => {
    expect(pricing.priceFor('claude-opus-4-7')).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 })
  })

  it('prefers the longest matching prefix', () => {
    expect(pricing.priceFor('claude-opus-4-7-20260101').input).toBe(5)
    expect(pricing.priceFor('claude-opus-4').input).toBe(15)
  })

  it('requires a token boundary after the prefix match', () => {
    const p = new Pricing()
    p.prices = {
      'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
      'claude-opus-4':   { input: 5,  output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    }
    expect(p.priceFor('claude-opus-4-10').input).toBe(5) // 4-10 is a 4.x, not 4-1
    expect(p.priceFor('claude-opus-4-1').input).toBe(15)
  })

  it('returns null for unknown / empty', () => {
    expect(pricing.priceFor('gpt-5')).toBeNull()
    expect(pricing.priceFor(null)).toBeNull()
    expect(pricing.priceFor('')).toBeNull()
  })

  it('treats a placeholder/zero-rate entry as unpriced, not free', () => {
    const p = new Pricing()
    p.prices = { 'claude-placeholder': { input: 0, output: 0, cacheRead: null, cacheWrite: null } }
    expect(p.priceFor('claude-placeholder-1')).toBeNull()
    expect(p.costUSD({ 'claude-placeholder-1': { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0 } })).toBeNull()
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
    expect(pricing.fastMultiplier('claude-opus-4-7')).toBeNull() // fast mode is offered on Opus 4.8 / 5 only
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

describe('long prompts', () => {
  // claude-haiku-5-5: input $0.1, output $0.5, cache read $0.01 per 1M; with a prompt past 100K: $0.5, $2.5, $0.05
  const long = pricing.billedAs('claude-haiku-5-5', { input: 10, output: 0, cacheRead: 60_000, cacheCreation: 40_000 })

  it('bills a call as a model of its own once its prompt, cache included, passes the threshold', () => {
    expect(long).not.toBe('claude-haiku-5-5')
    expect(pricing.billedAs('claude-haiku-5-5', { input: 60_000, output: 50_000, cacheRead: 40_000, cacheCreation: 0 })).toBe('claude-haiku-5-5') // exactly 100K
    expect(pricing.billedAs('claude-opus-4-7', { input: 900_000, output: 0, cacheRead: 0, cacheCreation: 0 })).toBe('claude-opus-4-7') // one set of rates
  })

  it('prices every token type at the long rates', () => {
    const M = 1_000_000
    const bucket = { input: M, output: M, cacheRead: M, cacheCreation: 2 * M, cacheCreation5m: M, cacheCreation1h: M }
    expect(pricing.costForDelta(long, bucket)).toBeCloseTo(0.5 + 2.5 + 0.05 + 0.625 + 1, 6)
  })

  it('bills a call past the threshold at them in each of the session\'s figures', () => {
    const reply = (id, second, read, output) => ({
      type: 'assistant', uuid: `${id}-${second}`, timestamp: new Date(Date.UTC(2026, 10, 21, 0, 0, second)).toISOString(),
      message: { id, role: 'assistant', model: 'claude-haiku-5-5', content: [], usage: { input_tokens: 0, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: 0 } },
    })
    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl', pricing })
    for (const r of [reply('a1', 0, 100_000, 10_000), reply('a2', 30, 200_000, 100), reply('a2', 31, 200_000, 10_000)]) {
      parser.feed(r)
    }
    const meta = parser.finalize(0)
    const sum = list => list.reduce((a, b) => a + b, 0)
    expect(meta.cost).toBeCloseTo(0.006 + 0.035, 6) // a1 at the base rates, a2 at the long ones
    expect(meta.tokensByModel[long]).toMatchObject({ cacheRead: 200_000, output: 10_000 })
    expect(sum(Object.values(meta.costByType))).toBeCloseTo(meta.cost, 6)
    expect(sum(meta.costSamples.map(s => s.cost))).toBeCloseTo(meta.cost, 6)
    expect(meta.cacheCosts['5m']).toBeCloseTo(meta.cost, 6)
  })
})

describe('SessionParser — cache costs', () => {
  // claude-opus-4-7: input $5, cache read $0.5, write $6.25 (5m) / $10 (1h) per 1M
  const at = minute => new Date(Date.UTC(2026, 9, 1, 0, 0, minute * 60)).toISOString()
  // A prompt sent at `minute`, its reply's first line `thinking` minutes later
  const turn = (id, minute, { read = 0, write5m = 0, write1h = 0, thinking = 0, model = 'claude-opus-4-7' }) => [
    { type: 'user', uuid: `u-${id}`, timestamp: at(minute), message: { role: 'user', content: 'go' } },
    { type: 'assistant', uuid: id, timestamp: at(minute + thinking), message: { id, role: 'assistant', model, content: [], usage: {
      input_tokens: 0, output_tokens: 1000, cache_read_input_tokens: read, cache_creation_input_tokens: write5m + write1h,
      cache_creation: { ephemeral_5m_input_tokens: write5m, ephemeral_1h_input_tokens: write1h },
    } } },
  ]
  const costsOf = turns => {
    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl', pricing })
    for (const r of turns.flat()) parser.feed(r)
    const meta = parser.finalize(0)
    return Object.fromEntries(Object.entries(meta.cacheCosts).map(([k, v]) => [k, +(v - meta.costByType.output).toFixed(4)]))
  }

  it('keeps a 5m cache warm across a 20 min pause under 1h', () => {
    expect(costsOf([
      turn('a1', 0, { write5m: 100_000 }),
      turn('a2', 20, { write5m: 100_000 }), // expired
      turn('a3', 21, { read: 100_000 }),
    ])).toEqual({ '5m': 1.3, '1h': 1.1 })
  })

  it('lets a 1h cache expire across a 10 min pause under 5m', () => {
    expect(costsOf([
      turn('a1', 0, { write1h: 100_000 }),
      turn('a2', 1, { read: 100_000 }),
      turn('a3', 11, { read: 100_000 }),
    ])).toEqual({ '5m': 1.3, '1h': 1.1 })
  })

  it('times a call by its prompt, not its reply after a long think', () => {
    expect(costsOf([
      turn('a1', 0, { write1h: 100_000 }),
      turn('a2', 3, { read: 100_000, thinking: 2.5 }),
    ])).toEqual({ '5m': 0.675, '1h': 1.05 })
  })

  it('credits no kept cache to a context that shrank', () => {
    expect(costsOf([
      turn('a1', 0, { write5m: 100_000 }),
      turn('a2', 30, { read: 10_000, write5m: 40_000 }), // compacted
    ])['1h']).toBe(1.405) // 1 + 0.005 + 0.4: only the observed 10K read
  })

  it('tracks the cache per model', () => {
    expect(costsOf([
      turn('a1', 0, { write5m: 100_000 }),
      turn('a2', 2, { write5m: 20_000, model: 'claude-sonnet-4-6' }),
      turn('a3', 10, { write5m: 100_000 }), // expired under 5m, warm under 1h since a1
    ])['1h']).toBe(1.17) // 1 + 0.12 (sonnet's own write) + 0.05: a1's 100K read back
  })

  it('prices a single call cheapest with 5m', () => {
    expect(costsOf([turn('a1', 0, { write5m: 100_000 })])).toEqual({ '5m': 0.625, '1h': 1 })
  })
})

const CURRENT_PATH = path.join(DATA_DIR, 'prices.current.json')

// Hits the network — opt-in via LIVE_TESTS=1 so the default suite stays portable/offline.
describe.skipIf(!process.env.LIVE_TESTS)('refreshPricesFromLiteLLM (live)', () => {
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

  it('fetches and writes prices.current.json with usable rates', async () => {
    await pricing.refreshFromLiteLLM(false)
    expect(fs.existsSync(CURRENT_PATH)).toBe(true)
    const opus = pricing.priceFor('claude-opus-4-7') || pricing.priceFor('claude-opus-4-5')
    expect(opus?.input).toBeGreaterThan(0)
    expect(opus?.output).toBeGreaterThan(0)
    expect(opus?.cacheRead).toBeGreaterThan(0)
    expect(opus?.cacheWrite).toBeGreaterThan(0)
    const haiku = pricing.priceFor('claude-haiku-5-5')
    expect(haiku?.long?.input).toBeGreaterThan(haiku.input) // its long-prompt rates are still listed under the names we read
  }, 20_000)
})
