// Rates per 1M tokens, sourced from LiteLLM's model_prices_and_context_window.json.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../paths.js'
import seed from '../config/prices.seed.json' with { type: 'json' } // bundled seed — early reads before the first refresh

const CURRENT_PATH = path.join(DATA_DIR, 'prices.current.json') // daily refresh is user data — never written into the install dir
const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const DAY_MS = 24 * 3600 * 1000
const MILLION = 1e6

// Emits 'update' when a background refresh changes the rate table.
export class Pricing extends EventEmitter {
  #prices = {}
  #keys = [] // longest first, so 'claude-opus-4-7' wins over 'claude-opus-4'

  constructor() {
    super()
    this.load()
    // refresh in the background; early reads use the seed table
    this.refreshFromLiteLLM().catch(err => console.warn('[pricing] refresh failed:', err.message))
  }

  get prices() { return this.#prices }
  set prices(rates) {
    this.#prices = {}
    for (const [key, p] of Object.entries(rates))
      if ([p.input, p.output, p.cacheRead, p.cacheWrite].every(r => r > 0)) this.#prices[key] = p // skip placeholder/partial entries (0/null/missing rates) — unknown pricing, not free
    this.#keys = Object.keys(this.#prices).sort((a, b) => b.length - a.length)
  }

  load() {
    this.prices = fs.existsSync(CURRENT_PATH) ? JSON.parse(fs.readFileSync(CURRENT_PATH, 'utf8')) : seed
  }

  priceFor(model) {
    if (!model) return null
    const m = model.toLowerCase()
    // the prefix must end on a token boundary: 'claude-opus-4-10' is a 4.x, not a 4-1
    const key = this.#keys.find(k => m.startsWith(k) && !/^\w/.test(m.slice(k.length)))
    return key ? this.#prices[key] : null
  }

  // Fast mode (usage.speed === "fast") bills at a flat per-model multiple of
  // standard rates, applied uniformly across every token category. Sourced from
  // LiteLLM's provider_specific_entry.fast. null when unknown for the model.
  fastMultiplier(model) {
    return this.priceFor(model)?.fastModeMplr ?? null
  }

  costForDelta(model, bucket, { ignoreCache1hPremium = false, fast = false } = {}) {
    const p = this.priceFor(model)
    if (!p || !bucket) return null
    const tokens5m = ignoreCache1hPremium ? 0 : (bucket.cacheCreation5m || 0)
    const tokens1h = ignoreCache1hPremium ? 0 : (bucket.cacheCreation1h || 0)
    const tokensUnknown = (bucket.cacheCreation || 0) - tokens5m - tokens1h
    const base = (
      (bucket.input || 0) * p.input +
      (bucket.output || 0) * p.output +
      (bucket.cacheRead || 0) * p.cacheRead +
      tokens5m * p.cacheWrite +
      tokens1h * (p.cacheWrite1h ?? p.cacheWrite) + // 1h premium unknown → bill at the base write rate, not $0
      tokensUnknown * p.cacheWrite
    ) / MILLION
    // Unknown multiplier → best-effort 1×; callers flag the session as inaccurate.
    return fast ? base * (this.fastMultiplier(model) ?? 1) : base
  }

  costUSD(tokensByModel, opts = {}) {
    if (!tokensByModel) return null
    let total = 0
    let priced = false
    for (const [model, bucket] of Object.entries(tokensByModel)) {
      const c = this.costForDelta(model, bucket, opts)
      if (c == null) continue
      total += c
      priced = true
    }
    return priced ? total : null
  }

  async refreshFromLiteLLM(verbose = true) {
    if (fs.existsSync(CURRENT_PATH) && Date.now() - fs.statSync(CURRENT_PATH).mtimeMs < DAY_MS) return
    if (verbose) console.info('[pricing] refreshing prices from LiteLLM:', LITELLM_URL)
    const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const litellm = await res.json()

    // Collect LiteLLM entries matching `prefix` into one record per model id, keyed without the prefix or any dated (-/@YYYYMMDD) / versioned (-vN[:N]) suffix,
    // so 'anthropic.claude-opus-4-8-20260520-v1:0' and 'claude-opus-4-8' both land under 'opus-4-8'.
    const collect = prefix => {
      const id = k => k.slice(prefix.length).replace(/[-@]\d{8}(-v\d+(:\d+)?)?$|-v\d+(:\d+)?$/, '')
      const out = {}
      Object.entries(litellm)
        .filter(([key]) => key.startsWith(prefix))
        .forEach(([key, v]) => Object.assign(out[id(key)] ??= {}, v))
      return out
    }
    const claude = collect('claude-')               // first-party, source of truth
    const anthropic = collect('anthropic.claude-')  // Bedrock, backfills missing fields
    const models = new Set([...Object.keys(anthropic), ...Object.keys(claude)])

    // Merge and remap
    const out = {}
    for (const name of models) {
      const m = Object.assign({}, anthropic[name], claude[name]) // Merge each model: anthropic.* backfills, claude-* wins (they disagree on claude-3-haiku's cache rates)
      const per = c => Number.isFinite(c) ? Number((c * MILLION).toPrecision(12)) : undefined // absent field → omitted, never NaN→null→$0; toPrecision kills float noise (0.199999… → 0.2)
      out['claude-' + name] = {
        input: per(m.input_cost_per_token),
        output: per(m.output_cost_per_token),
        cacheRead: per(m.cache_read_input_token_cost),
        cacheWrite: per(m.cache_creation_input_token_cost),
        cacheWrite1h: per(m.cache_creation_input_token_cost_above_1hr),
      }
      // Fast-mode multiplier lives only on the first-party claude-* variant.
      const fast = m.provider_specific_entry?.fast
      if (typeof fast === 'number') out['claude-' + name].fastModeMplr = fast
    }
    if (Object.keys(out).length) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(CURRENT_PATH, JSON.stringify(out, null, 2) + '\n')
      const before = JSON.stringify(this.#prices)
      this.load()
      if (verbose) console.info(`[pricing] updated ${Object.keys(out).length} model prices`)
      if (JSON.stringify(this.#prices) !== before) this.emit('update')
    }
  }
}
