// Rates per 1M tokens, sourced from LiteLLM's model_prices_and_context_window.json.
import fs from 'node:fs'
import path from 'node:path'

const SEED_PATH = path.resolve(import.meta.dirname, '../../cache/prices.json')
const CURRENT_PATH = path.resolve(import.meta.dirname, '../../cache/prices.current.json')
const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const DAY_MS = 24 * 3600 * 1000

class Pricing {
  constructor() {
    this.load()
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

  costUSD(tokensByModel, { ignoreCache1hPremium = false } = {}) {
    if (!tokensByModel) return null
    let total = 0
    let priced = false
    for (const [model, bucket] of Object.entries(tokensByModel)) {
      const p = this.priceFor(model)
      if (!p) continue
      const tokens5m = ignoreCache1hPremium ? 0 : (bucket.cacheCreation5m || 0)
      const tokens1h = ignoreCache1hPremium ? 0 : (bucket.cacheCreation1h || 0)
      const tokensUnknown = (bucket.cacheCreation || 0) - tokens5m - tokens1h
      total += (
        (bucket.input || 0) * p.input +
        (bucket.output || 0) * p.output +
        (bucket.cacheRead || 0) * p.cacheRead +
        tokens5m * p.cacheWrite +
        tokens1h * p.cacheWrite1h +
        tokensUnknown * p.cacheWrite
      ) / 1e6
      priced = true
    }
    return priced ? total : null
  }

  async refreshFromLiteLLM() {
    try {
      if (fs.existsSync(CURRENT_PATH) && Date.now() - fs.statSync(CURRENT_PATH).mtimeMs < DAY_MS) return
      const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const litellm = await res.json()
      // LiteLLM keys look like 'anthropic.claude-opus-4-5-20251101-v1:0' — strip provider and dated suffix.
      const norm = k => k.toLowerCase().replace(/^anthropic\./, '').replace(/-\d{8}(-v\d+:\d+)?$|-v\d+:\d+$/, '')
      const out = {}
      for (const [k, v] of Object.entries(litellm)) {
        const ourKey = Object.keys(this.prices).find(key => norm(k) === key)
        if (!ourKey || out[ourKey]) continue
        const i = v?.input_cost_per_token, o = v?.output_cost_per_token
        const r = v?.cache_read_input_token_cost, w = v?.cache_creation_input_token_cost
        const w1h = v?.cache_creation_input_token_cost_above_1hr
        if (!i || !o || !r || !w || !w1h) continue
        const perMillion = x => x * 1e6
        out[ourKey] = { input: perMillion(i), output: perMillion(o), cacheRead: perMillion(r), cacheWrite: perMillion(w), cacheWrite1h: perMillion(w1h) }
      }
      if (!Object.keys(out).length) return
      fs.writeFileSync(CURRENT_PATH, JSON.stringify(out, null, 2) + '\n')
      this.load()
    } catch (err) {
      console.warn('[pricing] refresh failed:', err.message)
    }
  }
}

export const pricing = new Pricing()
export const costUSD = (tokensByModel, opts) => pricing.costUSD(tokensByModel, opts)
export const refreshPricesFromLiteLLM = () => pricing.refreshFromLiteLLM()
