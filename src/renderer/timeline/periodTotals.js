import { cheaperCache } from '../utils/cacheAdvice.js'
import { THRESHOLDS as T } from '../utils/thresholds.js'

// A period's figures as its summary shows them, from its sessions

export function sumTotals(sessions) {
  const t = sessions.reduce((acc, s) => {
    acc.cost += s.cost || 0
    const cheaper = cheaperCache(s) // every session's, so many small savings still add up
    if (cheaper) acc.cacheSavings[cheaper.policy] = (acc.cacheSavings[cheaper.policy] || 0) + cheaper.saving
    acc.totalTokens += s.totalTokens || 0
    acc.input += s.tokens.input
    acc.output += s.tokens.output
    acc.cacheRead += s.tokens.cacheRead
    acc.cacheCreation += s.tokens.cacheCreation
    acc.cacheCreation1h += s.tokens.cacheCreation1h || 0
    for (const k in s.costByType) acc.costByType[k] = (acc.costByType[k] || 0) + s.costByType[k]
    acc.advisor.calls += s.advisor?.calls || 0
    acc.advisor.cost += s.advisor?.cost || 0
    acc.activeMs += s.activeMs || 0
    return acc
  }, {
    cost: 0, cacheSavings: {}, totalTokens: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cacheCreation1h: 0, activeMs: 0, costByType: {},
    advisor: { calls: 0, cost: 0 },
  })
  const cacheDenom = t.cacheRead + t.cacheCreation
  t.cacheHitRatio = cacheDenom > 0 ? t.cacheRead / cacheDenom : null
  t.cacheSavings = Object.entries(t.cacheSavings).filter(([, saving]) => saving > T.cacheSaving.min)
  return t
}

// The totals' tokens by kind, each with what it cost
export function tokenMix(totals) {
  const c = totals.costByType
  return [
    { label: 'Cache read', tokens: totals.cacheRead, cost: c.cacheRead, color: '#3b4a63' },
    { label: 'Cache write', tokens: totals.cacheCreation - totals.cacheCreation1h, cost: c.cacheWrite, color: '#d97706' },
    totals.cacheCreation1h > 0 && { label: 'Cache write (1h)', tokens: totals.cacheCreation1h, cost: c.cacheWrite1h, color: 'var(--warn)' },
    { label: 'Output', tokens: totals.output, cost: c.output, color: 'var(--accent)' },
    { label: 'Input', tokens: totals.input, cost: c.input, color: '#ddd6fe' },
  ].filter(Boolean)
}

export function groupByProject(sessions) {
  const map = new Map()
  for (const s of sessions) {
    const key = s.project || '(no project)'
    let g = map.get(key)
    if (!g) {
      g = { key, projectShort: s.projectShort, cost: 0, totalTokens: 0, byDir: new Map() }
      map.set(key, g)
    }
    const dir = s.subdir ?? ''
    let d = g.byDir.get(dir)
    if (!d) g.byDir.set(dir, d = { dir, cost: 0, totalTokens: 0 })
    for (const t of [g, d]) {
      t.cost += s.cost || 0
      t.totalTokens += s.totalTokens || 0
    }
  }
  return [...map.values()]
}

// The cost and tokens of each bucket of time, given by their starts in order: a sample counts where it began, one from before the first in the first
export function bucketTotals(starts, sessions) {
  const buckets = starts.map(start => ({ start, cost: 0, tokens: 0 }))
  for (const s of sessions) {
    for (const sample of s.costSamples ?? []) {
      let i = buckets.length - 1
      while (i > 0 && buckets[i].start > sample.start) i--
      buckets[i].cost += sample.cost || 0
      buckets[i].tokens += sample.tokens || 0
    }
  }
  return buckets
}
