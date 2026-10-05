// Refresh schedule — each check spawns a Claude Code process (~1s, ~250 MB), so it's sparse:
// - when the app opens or the window regains focus, if over a minute old
// - within a minute of Claude Code writing a transcript, repeating while it keeps writing
// - never while the window is hidden; regaining focus catches up
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

// The plan's 5h/7d usage, as Claude Code's /usage reports it — through the user's own Claude Code
// login, so it covers every client (CLI, desktop, claude.ai). Null for API key / Bedrock / Vertex logins.
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
    if (Date.now() - this.#fetchedAt >= EVERY && (this.#active || !ifActive)) {
      this.#fetchedAt = Date.now()
      this.#active    = false
      this.#limits    = this.#fetch()
    }
    return this.#limits
  }

  async #fetch() {
    try {
      const { subscription_type: plan, rate_limits: rl } = await this.#agentRunner.usage()
      return rl && {
        at: Date.now(),
        plan, // 'pro' | 'max' | 'team' | 'enterprise'
        fiveHour: toWindow(rl.five_hour),
        sevenDay: toWindow(rl.seven_day),
        models: (rl.model_scoped ?? []).filter(m => m.utilization != null).map(m => ({ name: m.display_name, ...toWindow(m) })), // per-model weekly caps
        sources: (rl.seven_day_breakdown?.rows ?? []).filter(r => r.percent > 0).map(r => ({ name: r.display_name, pct: r.percent })), // undocumented: Claude Code / Chats / Cowork shares of the week
        extra: toExtra(rl.extra_usage),
      }
    } catch (err) {
      console.warn('[rate-limits]', err.message) // the API is experimental — hide the bars rather than fail
      return null
    }
  }
}
