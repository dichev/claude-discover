// Rates per 1M tokens, mirroring LiteLLM's model_prices_and_context_window.json
// (the same source ccusage uses). Cache-write is a single rate — LiteLLM does
// not track Anthropic's 1h cache premium, and we match that to stay aligned
// with ccusage.
const PRICES = {
  'claude-opus-4-7':     { input:  5,    output: 25, cacheRead: 0.50, cacheWrite:  6.25 },
  'claude-opus-4-6':     { input:  5,    output: 25, cacheRead: 0.50, cacheWrite:  6.25 },
  'claude-opus-4-5':     { input:  5,    output: 25, cacheRead: 0.50, cacheWrite:  6.25 },
  'claude-opus-4-1':     { input: 15,    output: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-opus-4':       { input: 15,    output: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-sonnet-4-6':   { input:  3,    output: 15, cacheRead: 0.30, cacheWrite:  3.75 },
  'claude-sonnet-4-5':   { input:  3,    output: 15, cacheRead: 0.30, cacheWrite:  3.75 },
  'claude-sonnet-4':     { input:  3,    output: 15, cacheRead: 0.30, cacheWrite:  3.75 },
  'claude-haiku-4-5':    { input:  1,    output:  5, cacheRead: 0.10, cacheWrite:  1.25 },
  'claude-3-5-sonnet':   { input:  3,    output: 15, cacheRead: 0.30, cacheWrite:  3.75 },
  'claude-3-5-haiku':    { input:  0.80, output: 4,  cacheRead: 0.08, cacheWrite:  1    },
  'claude-3-opus':       { input: 15,    output: 75, cacheRead: 1.50, cacheWrite: 18.75 },
}

// Match by longest prefix so 'claude-opus-4-7' wins over 'claude-opus-4'.
const KEYS_BY_LENGTH = Object.keys(PRICES).sort((a, b) => b.length - a.length)

function priceFor(model) {
  if (!model) return null
  const m = model.toLowerCase()
  for (const key of KEYS_BY_LENGTH) {
    if (m.startsWith(key)) return PRICES[key]
  }
  return null
}

function bucketCost(p, b) {
  return (
    (b.input || 0) * p.input +
    (b.output || 0) * p.output +
    (b.cacheRead || 0) * p.cacheRead +
    (b.cacheCreation || 0) * p.cacheWrite
  ) / 1e6
}

export function costUSD(tokensByModel) {
  if (!tokensByModel) return null
  let total = 0
  let priced = false
  for (const [model, bucket] of Object.entries(tokensByModel)) {
    const p = priceFor(model)
    if (!p) continue
    total += bucketCost(p, bucket)
    priced = true
  }
  return priced ? total : null
}
