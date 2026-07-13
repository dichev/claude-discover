const ACTIVITY_GAP_MS = 5 * 60 * 1000
const TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'cacheCreation', 'cacheCreation5m', 'cacheCreation1h']

function emptyBucket() {
  return Object.fromEntries(TOKEN_FIELDS.map(k => [k, 0]))
}

function addUsage(target, delta) {
  for (const k of TOKEN_FIELDS) target[k] += delta[k]
}

function extractText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (typeof b === 'string' ? b : b?.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n')
}

function shortProject(dir, depth = 2) {
  if (!dir) return '(no project)'
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-depth).join('/') || dir
}

// Suffix labels for a set of dirs: the last `depth` segments of each, one segment more where that
// collides (tmp-1/app/run vs tmp-2/app/run, while /users/dev/app stays dev/app).
export function suffixLabels(dirs, depth = 2) {
  const labels = new Map([...new Set(dirs)].map(dir => [dir, shortProject(dir, depth)]))
  const counts = new Map()
  for (const label of labels.values()) counts.set(label, (counts.get(label) ?? 0) + 1)
  for (const [dir, label] of labels) if (counts.get(label) > 1) labels.set(dir, shortProject(dir, depth + 1))
  return labels
}

function classifySource(meta) {
  if (meta.hasScheduledTask) return 'scheduled'
  return (meta.entrypoint || '').toLowerCase() || 'other'
}

function freshMeta({ sessionId, parentSessionId, filePath, fileSize, mtime }) {
  return {
    sessionId, parentSessionId, filePath, fileSize, mtime,
    startedAt: null, lastActivityAt: null,
    entrypoint: null, project: null, worktree: null, worktreePath: null, gitBranch: null, version: null,
    model: null, models: [], serviceTier: null, speed: null, fastPricingUnknown: false, priceUnknown: false,
    summary: null, aiTitle: null, customTitle: null, agentName: null, firstUserPrompt: null, firstUserCommand: null, forkedFrom: null,
    messageCount: 0, workflowAgents: 0, toolCalls: 0,
    tokens: emptyBucket(), tokensByModel: {}, tokensByModelFast: {}, lastContextTokens: 0,
    serverToolUse: { webSearch: 0, webFetch: 0 },
    hasScheduledTask: false,
    activityPeriods: [],
    costSamples: [],
    seenMessageIds: new Set()
  }
}

export class SessionParser {
  constructor({ sessionId, parentSessionId, filePath, fileSize = 0, mtime = 0, pricing = null, range = null, excludeIds = null }) {
    this.range = range
    this.excludeIds = excludeIds
    this.pricing = pricing
    this.meta = freshMeta({ sessionId, parentSessionId, filePath, fileSize, mtime })
    // Per-stream state for stamping items with running totals; not part of meta.
    this.prevMessage = null
    this.tokenTotal = 0
    this.lastSeenTs = null
    // msgId -> the usage bucket we've already folded into the totals, so later
    // snapshots of a streamed reply can contribute only their growth.
    this.appliedById = new Map()
  }

  // Returns true if the item passes `this.range`.
  feed(obj) {
    const meta = this.meta
    const t = obj.type
    if (t === 'summary' && obj.summary) meta.summary = obj.summary
    if (t === 'ai-title' && obj.aiTitle) meta.aiTitle = obj.aiTitle
    if (t === 'custom-title' && obj.customTitle) meta.customTitle = obj.customTitle
    if (t === 'agent-name' && obj.agentName) meta.agentName = obj.agentName
    if (t === 'queue-operation' && obj.content?.includes('<scheduled-task')) meta.hasScheduledTask = true
    if (t === 'started' && obj.key && obj.agentId) meta.workflowAgents += 1 // workflow journal: one `started` record per agent() call

    if (obj.cwd && !meta.project) meta.project = obj.cwd
    if (obj.gitBranch && !meta.gitBranch) meta.gitBranch = obj.gitBranch
    if (obj.entrypoint && !meta.entrypoint) meta.entrypoint = obj.entrypoint
    if (obj.version && !meta.version) meta.version = obj.version

    // Untimestamped events (permission-mode, ai-title, last-prompt, …) inherit the previous timestamped event's ts; if none has been seen yet, fall back to file mtime — but don't let that mtime fallback extend session bounds (mtime can be much later than the real events, e.g. when the file is touched by an unrelated process).
    const parsed = obj.timestamp && Date.parse(obj.timestamp)
    const inherited = parsed > 0 ? parsed : this.lastSeenTs
    const ts = inherited ?? meta.mtime
    if (parsed > 0) this.lastSeenTs = parsed
    if (this.range && (ts < this.range.start || ts > this.range.end)) return false
    obj._ts = ts
    if (inherited != null) {
      if (meta.startedAt == null || inherited < meta.startedAt) meta.startedAt = inherited
      if (inherited > meta.lastActivityAt) meta.lastActivityAt = inherited
    }

    // Standalone attachment entries are always harness-injected context
    // (diagnostics, task_reminder, selected_lines_in_ide, etc.), never user input.
    if (t === 'attachment') {
      obj.isMeta = true
      this.prevMessage = obj
      return true
    }
    if (t !== 'user' && t !== 'assistant') return true
    meta.messageCount += 1

    const last = meta.activityPeriods[meta.activityPeriods.length - 1]
    if (last && ts - last.end <= ACTIVITY_GAP_MS) {
      if (ts > last.end) last.end = ts
    } else {
      meta.activityPeriods.push({ start: ts, end: ts })
    }

    if (t === 'user') {
      this._feedUser(obj)
    } else if (t === 'assistant') {
      const msg = obj.message
      // Skip local error/limit notices (e.g. "limit reached") — not real model calls.
      if (!msg || msg.model === '<synthetic>') return true
      if (msg.model) {
        if (!meta.model) meta.model = msg.model
        if (!meta.models.includes(msg.model)) meta.models.push(msg.model)
      }
      // tool_use blocks stream across a reply's lines without repeating, so a plain per-line sum is exact.
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) if (b?.type === 'tool_use') meta.toolCalls += 1
      }
      this._recordUsage(obj)
    }
    this.prevMessage = obj
    return true
  }

  // Capture the first user prompt / command for the session list.
  _feedUser(obj) {
    const meta = this.meta
    if (!meta.forkedFrom && obj.forkedFrom?.sessionId) meta.forkedFrom = obj.forkedFrom
    const text = extractText(obj.message?.content)
    if (text.startsWith('<command-name>') || text.startsWith('<command-message>')) {
      if (!meta.firstUserCommand) meta.firstUserCommand = text
      obj.isMeta = true
    } else if (text.startsWith('<local-command-stdout>')) {
      // stdout arrives as a separate message after the command-name entry
      if (meta.firstUserCommand) meta.firstUserCommand += '\n' + text
      obj.isMeta = true
    } else if (text.startsWith('<local-command-caveat>')) {
      // CLI-injected wrapper note, not real user content
      obj.isMeta = true
    } else if (text.startsWith('<scheduled-task')) {
      meta.hasScheduledTask = true
    } else if (text) {
      if (!meta.firstUserPrompt) meta.firstUserPrompt = text.slice(0, 300)
    }
  }

  // Stamp obj (and the turn that caused it) with per-item running token totals for the UI.
  // Input tokens attribute to the turn that *caused* the call (user prompt or tool_result) —
  // the model is billed for reading the preceding turn.
  _stampRunningTotals(obj, contextSize, output) {
    const inputTarget = this.prevMessage && this.prevMessage._tokenDelta == null ? this.prevMessage : obj
    this.tokenTotal += contextSize
    inputTarget._tokenDelta = (inputTarget._tokenDelta || 0) + contextSize
    inputTarget._tokenTotal = this.tokenTotal
    this.tokenTotal += output
    obj._tokenDelta = (obj._tokenDelta || 0) + output
    obj._tokenTotal = this.tokenTotal
  }

  // One assistant reply is written as several jsonl lines sharing message.id:
  // input/cache stay fixed while output_tokens grows toward its final value. We
  // add each line's *growth* over the previous one (the full usage on the first
  // line), so the totals land on the final value — what ccusage bills. The
  // per-item running-total stamps and the stream-stable metadata come only from
  // the first line; ids in `excludeIds` (already counted in an earlier
  // resumed-from session) stamp but never aggregate.
  _recordUsage(obj) {
    const meta = this.meta
    const msg = obj.message
    const u = msg?.usage
    const msgId = msg?.id
    if (!u || !msgId) return
    const cc = u.cache_creation || {}
    const usage = {
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheCreation: u.cache_creation_input_tokens || 0,
      cacheCreation5m: cc.ephemeral_5m_input_tokens || 0,
      cacheCreation1h: cc.ephemeral_1h_input_tokens || 0,
    }
    const model = msg.model || 'unknown'
    const fast = u.speed === 'fast'
    const contextSize = usage.input + usage.cacheRead + usage.cacheCreation

    if (!meta.seenMessageIds.has(msgId)) {
      meta.seenMessageIds.add(msgId)
      this._stampRunningTotals(obj, contextSize, usage.output)
    }
    if (this.excludeIds?.has(msgId)) return

    const applied = this.appliedById.get(msgId)
    if (!applied) { // first non-excluded line of this reply — record stream-stable metadata once
      meta.lastContextTokens = contextSize // prompt size on this turn; last assistant message wins
      if (u.service_tier) meta.serviceTier = u.service_tier
      if (this.pricing && this.pricing.priceFor(model) == null) meta.priceUnknown = true
      if (fast) {
        meta.speed = 'fast'
        // No known multiplier → fast cost can't be computed accurately; flag it.
        if (this.pricing && this.pricing.fastMultiplier(model) == null) meta.fastPricingUnknown = true
      } else if (u.speed && meta.speed !== 'fast') {
        meta.speed = u.speed // 'standard'; 'fast' once seen stays sticky
      }
      if (u.server_tool_use) {
        meta.serverToolUse.webSearch += u.server_tool_use.web_search_requests || 0
        meta.serverToolUse.webFetch += u.server_tool_use.web_fetch_requests || 0
      }
    }
    this.appliedById.set(msgId, usage)

    const growth = emptyBucket()
    let changed = false
    for (const k of TOKEN_FIELDS) { growth[k] = usage[k] - (applied?.[k] ?? 0); if (growth[k] !== 0) changed = true }
    if (!changed) return // a repeat line that added nothing
    // Fast and standard tokens price differently, so keep separate per-model buckets.
    const byModel = fast ? meta.tokensByModelFast : meta.tokensByModel
    addUsage(meta.tokens, growth)
    addUsage(byModel[model] ??= emptyBucket(), growth)
    const cost = this.pricing && obj._ts != null ? this.pricing.costForDelta(model, growth, { fast }) : null
    if (cost > 0) {
      const prevTs = this.prevMessage?._ts
      meta.costSamples.push({ start: prevTs != null && prevTs < obj._ts ? prevTs : obj._ts, end: obj._ts, cost })
    }
  }

  finalize(mtimeFallback) {
    const meta = this.meta
    if (meta.startedAt == null) meta.startedAt = mtimeFallback
    if (meta.lastActivityAt == null) meta.lastActivityAt = mtimeFallback
    meta.source = classifySource(meta)
    // Worktree sessions (cwd under <repo>/.claude/worktrees/<name>) belong to the parent repo, not a project of their own
    const wt = meta.project && meta.project.replace(/\\/g, '/').match(/\/\.claude\/worktrees\/([^/]+)/)
    if (wt) {
      meta.worktree = wt[1]
      meta.worktreePath = meta.project.slice(0, wt.index + wt[0].length)
      meta.project = meta.project.slice(0, wt.index)
    }
    meta.projectShort = shortProject(meta.project)
    meta.activeMs = meta.activityPeriods.reduce((sum, p) => sum + Math.max(0, p.end - p.start), 0)
    const t = meta.tokens
    meta.totalTokens = t.input + t.output + t.cacheRead + t.cacheCreation
    const cacheDenom = t.cacheRead + t.cacheCreation
    meta.cacheHitRatio = cacheDenom > 0 ? t.cacheRead / cacheDenom : null
    const costOf = opts => !this.pricing ? 0
      : (this.pricing.costUSD(meta.tokensByModel, opts) || 0) + (this.pricing.costUSD(meta.tokensByModelFast, { ...opts, fast: true }) || 0)
    meta.cost = costOf({})
    // What the session would have cost with only 5m cache (no 1h premium); the gap is the potential saving.
    meta.savings = { using5mCache: meta.cost - costOf({ ignoreCache1hPremium: true }) }
    return meta
  }
}

