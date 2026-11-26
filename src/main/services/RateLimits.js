// Refresh schedule — each check spawns a Claude Code process (~1s, ~250 MB), so it's sparse:
// - when the app opens or the window regains focus, if over a minute old
// - within a minute of Claude Code writing a transcript, repeating while it keeps writing
// - never while the window is hidden; regaining focus catches up
// - after a failed fetch, at the next ask: claude.ai's usage endpoint drops out for minutes at a time
// The status bar does the asking; this decides when an ask is worth a fetch.
const EVERY = 60_000

const toWindow = w => w?.utilization == null ? null : {
  utilization: w.utilization, // 0..100
  resetsAt: w.resets_at ? Math.round(Date.parse(w.resets_at) / 60_000) * 60_000 : null, // the server sends 16:29:59.72 for 16:30
}

// Paid usage past the plan limits. Amounts are in minor units (cents); `reason` says why it's off when the user didn't turn it off
const toExtra = e => e && {
  on:       e.is_enabled,
  reason:   !e.is_enabled && !e.user_disabled ? e.disabled_reason : null, // e.g. 'out_of_credits'
  used:     e.used_credits,
  limit:    e.monthly_limit,
  currency: e.currency,
  decimals: e.decimal_places ?? 2,
}

// Undocumented: a model's slice of the overall week, as used and allowed percentages of it. Its `limit_index` points into the
// server's limits[], which model_scoped doesn't carry, so it's paired with a model only when there's one of each
const toShare = (shares, models) => shares?.length === 1 && models.length === 1 ? {
  name:      models[0].display_name,
  used:      shares[0].used_percent_of_weekly,
  allowance: shares[0].allowance_percent_of_weekly,
} : null

// The plan's 5h/7d usage, as Claude Code's /usage reports it — through the user's own Claude Code
// login, so it covers every client (CLI, desktop, claude.ai). Null for API key / Bedrock / Vertex logins.
// Undefined when the fetch failed, so the status bar keeps its last answer until the next one.
export class RateLimits {
  #agentRunner
  #limits    = null // the latest fetch's promise, shared by concurrent callers
  #fetchedAt = 0
  #active    = false // a transcript changed since the last fetch

  constructor(agentRunner) {
    this.#agentRunner = agentRunner
  }

  // A transcript changed
  markActive() {
    this.#active = true
  }

  // Refetched once over a minute old; with `ifActive`, only if Claude Code wrote a transcript since
  get({ ifActive = false } = {}) {
    if (Date.now() - this.#fetchedAt >= EVERY && (this.#active || !ifActive)) this.use(this.#agentRunner.usage())
    return this.#limits
  }

  // Takes a /usage answer, also one already on its way (UsageInsights' scans carry the limits too), so no other process starts
  use(usage) {
    this.#fetchedAt = Date.now()
    this.#active    = false
    const limits = this.#limits = this.#map(usage).then(l => {
      if (l === undefined && this.#limits === limits) { // not waited out, unless a newer fetch already replaced it
        this.#fetchedAt = 0
        this.#active    = true
      }
      return l
    })
  }

  async #map(usage) {
    try {
      const { subscription_type: type, account, rate_limits: rl, rate_limits_available: available } = await usage
      if (!rl && available) {
        console.warn("[rate-limits] the plan has limits, but claude.ai's usage endpoint didn't answer")
        return undefined
      }
      if (!rl) return null
      const models = rl.model_scoped?.filter(m => m.utilization != null) ?? []
      return {
        at: Date.now(),
        plan: account?.subscriptionType?.replace(/^Claude /, '') ?? type, // 'Ultra' from 'Claude Ultra', where /usage only says 'max'
        fiveHour: toWindow(rl.five_hour),
        sevenDay: toWindow(rl.seven_day),
        models: models.map(m => ({ name: m.display_name, ...toWindow(m) })), // per-model weekly caps
        share: toShare(rl.weekly_scoped_shares, models),
        sources: (rl.seven_day_breakdown?.rows ?? []).filter(r => r.percent > 0).map(r => ({ name: r.display_name, pct: r.percent })), // undocumented: Claude Code / Chats / Cowork shares of the week
        extra: toExtra(rl.extra_usage),
      }
    } catch (err) {
      console.warn('[rate-limits]', err.message) // also a timeout, or the experimental API changed
      return undefined
    }
  }
}
