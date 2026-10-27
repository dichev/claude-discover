import { THRESHOLDS as T } from './thresholds.js'

export const CACHE_LABELS = { '5m': 'with 5m cache', '1h': 'with 1h cache' }

// The cache TTL the session would have cost the least with, and how much less
export function cheaperCache({ cost, cacheCosts }) {
  if (!cacheCosts || !cost) return null
  const [policy, cheapest] = Object.entries(cacheCosts).reduce((a, b) => b[1] < a[1] ? b : a)
  return { policy, saving: cost - cheapest }
}

// The cheaper TTL when it would have cut the session's cost noticeably
export function cacheAdvice(s) {
  const c = cheaperCache(s)
  return c && c.saving > Math.max(T.cacheSaving.share * s.cost, T.cacheSaving.min) ? { ...c, pct: c.saving / s.cost * 100 } : null
}
