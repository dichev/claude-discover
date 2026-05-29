// Rates per 1M tokens, sourced from LiteLLM's model_prices_and_context_window.json.
import fs from 'node:fs'
import path from 'node:path'

const SEED_PATH = path.resolve(process.cwd(), 'cache/prices.json')
const CURRENT_PATH = path.resolve(process.cwd(), 'cache/prices.current.json')
const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const DAY_MS = 24 * 3600 * 1000

export class Pricing {
  constructor() {
    this.load()
    // refresh in the background; early reads use the seed table
    this.refreshFromLiteLLM().catch(err => console.warn('[pricing] refresh failed:', err.message))
  }

  load() {
    const file = fs.existsSync(CURRENT_PATH) ? CURRENT_PATH : SEED_PATH
    this.prices = JSON.parse(fs.readFileSync(file, 'utf8'))
    // Match by longest prefix so 'claude-opus-4-7' wins over 'claude-opus-4'.
    this.keysByLength = Object.keys(this.prices).sort((a, b) => b.length - a.length)
  }

  priceFor(model) {
    if (!model) return null
    const m = model.toLowerCase()
    for (const key of this.keysByLength) {
      if (m.startsWith(key)) return this.prices[key]
    }
    return null
  }

  costForDelta(model, bucket, { ignoreCache1hPremium = false } = {}) {
    const p = this.priceFor(model)
    if (!p || !bucket) return null
    const tokens5m = ignoreCache1hPremium ? 0 : (bucket.cacheCreation5m || 0)
    const tokens1h = ignoreCache1hPremium ? 0 : (bucket.cacheCreation1h || 0)
    const tokensUnknown = (bucket.cacheCreation || 0) - tokens5m - tokens1h
    return (
      (bucket.input || 0) * p.input +
      (bucket.output || 0) * p.output +
      (bucket.cacheRead || 0) * p.cacheRead +
      tokens5m * p.cacheWrite +
      tokens1h * p.cacheWrite1h +
      tokensUnknown * p.cacheWrite
    ) / 1e6
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

  async refreshFromLiteLLM() {
    if (fs.existsSync(CURRENT_PATH) && Date.now() - fs.statSync(CURRENT_PATH).mtimeMs < DAY_MS) return
    console.info('[pricing] refreshing prices from LiteLLM:', LITELLM_URL)
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
    const M = 1e6  // 1M tokens
    const out = {}
    for (const name of models) {
      const m = Object.assign({}, anthropic[name], claude[name]) // Merge each model: anthropic.* backfills, claude-* wins (they disagree on claude-3-haiku's cache rates)
      out['claude-' + name] = {
        input: m.input_cost_per_token * M,
        output: m.output_cost_per_token * M,
        cacheRead: m.cache_read_input_token_cost * M,
        cacheWrite: m.cache_creation_input_token_cost * M,
        cacheWrite1h: m.cache_creation_input_token_cost_above_1hr * M,
      }
    }
    if (Object.keys(out).length) {
      fs.writeFileSync(CURRENT_PATH, JSON.stringify(out, null, 2) + '\n')
      this.load()
      console.info(`[pricing] updated ${Object.keys(out).length} model prices`)
    }
  }
}
