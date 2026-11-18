const EVERY = 60 * 60_000

// What /usage says is using the plan's limits: Claude Code's scan of every transcript touched in the last 7 days (~1s, no tokens,
// nothing uploaded), so it's refetched once an hour at most. The renderer asks while the empty detail pane shows it;
// its startup ask is `force`d, so a page reload rescans too
export class UsageInsights {
  #agentRunner
  #insights  = null // the latest fetch's promise, shared by concurrent callers
  #fetchedAt = 0

  constructor(agentRunner) {
    this.#agentRunner = agentRunner
  }

  get({ force = false } = {}) {
    if (force || Date.now() - this.#fetchedAt >= EVERY) {
      this.#fetchedAt = Date.now()
      this.#insights  = this.#agentRunner.usage({ behaviors: true }).then(u => u.behaviors && { at: Date.now(), ...u.behaviors }, err => {
        console.warn('[usage-insights]', err.message) // the API is experimental — hide the panel rather than fail
        return null
      })
    }
    return this.#insights
  }
}
