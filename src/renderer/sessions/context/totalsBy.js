import { TOKEN_FIELDS } from '../../../shared/usage.js'

// What the session had spent before `until` (a time; null: by now), as its meta's own figures: cost and tokens from its cost samples,
// which add up to its totals exactly, server tool calls from theirs, and working time from its active periods
export function totalsBy(meta, until) {
  if (until == null) return meta
  const before   = list => list.filter(s => s.end < until)
  const samples  = before(meta.costSamples)
  const sum      = (list, get) => list.reduce((a, s) => a + get(s), 0)
  const tokens   = Object.fromEntries(TOKEN_FIELDS.map(k => [k, sum(samples, s => s.usage[k])]))
  const cached   = tokens.cacheRead + tokens.cacheCreation
  const servers  = before(meta.serverToolSamples)
  return {
    cost: sum(samples, s => s.cost),
    totalTokens: sum(samples, s => s.tokens),
    tokens,
    cacheHitRatio: cached > 0 ? tokens.cacheRead / cached : null,
    serverToolUse: { webSearch: sum(servers, s => s.webSearch), webFetch: sum(servers, s => s.webFetch) },
    activeMs: sum(meta.activityPeriods, p => Math.max(0, Math.min(p.end, until) - p.start)),
  }
}
