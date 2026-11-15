import { advisorIterations } from '../../../shared/usage.js'
import { emptyBucket, addUsage, usageOf, isEmpty, tokenCount } from './buckets.js'

// The advisor tool runs a second model server-side, billed apart: its tokens are logged only among a reply's
// usage iterations. They count in the session's totals, but are no part of its context nor of the executor's cache.
export class AdvisorUsage {
  calls = 0
  byModel = {}
  byModelFast = {}

  // A reply's advisor calls, keyed apart as a reply can hold several
  static inReply(msgId, u) {
    return advisorIterations(u).map((it, i) => ({ key: `${msgId}#${i}`, model: it.model || 'unknown', fast: it.speed === 'fast', usage: usageOf(it) }))
  }

  add(call, growth, firstSeen) {
    if (firstSeen) this.calls += 1
    if (!isEmpty(growth)) addUsage((call.fast ? this.byModelFast : this.byModel)[call.model] ??= emptyBucket(), growth)
  }

  summary(pricing) {
    const { calls, byModel, byModelFast } = this
    const totalTokens = [...Object.values(byModel), ...Object.values(byModelFast)].reduce((sum, b) => sum + tokenCount(b), 0)
    return { calls, byModel, byModelFast, models: Object.keys({ ...byModel, ...byModelFast }), cost: this._cost(pricing), totalTokens }
  }

  // Not the executor's cache, so the same under any cache TTL
  promptCost(pricing) {
    return this._cost(pricing, b => ({ ...b, output: 0 }))
  }

  _cost(pricing, part = b => b) {
    if (!pricing) return 0
    const priced = (byModel, opts) => pricing.costUSD(Object.fromEntries(Object.entries(byModel).map(([m, b]) => [m, part(b)])), opts) || 0
    return priced(this.byModel) + priced(this.byModelFast, { fast: true })
  }
}
