const ACTIVITY_GAP_MS = 5 * 60 * 1000
const TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'cacheCreation', 'cacheCreation5m', 'cacheCreation1h']

function emptyBucket() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cacheCreation5m: 0, cacheCreation1h: 0 }
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

function shortProject(dir) {
  if (!dir) return '(no project)'
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/') || dir
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
    model: null, models: [], serviceTier: null, speed: null, fastPricingUnknown: false,
    summary: null, aiTitle: null, customTitle: null, agentName: null, firstUserPrompt: null, firstUserCommand: null, forkedFrom: null,
    messageCount: 0, workflowAgents: 0,
    tokens: emptyBucket(), tokensByModel: {}, tokensByModelFast: {}, lastContextTokens: 0,
    serverToolUse: { webSearch: 0, webFetch: 0 },
    hasScheduledTask: false,
    activityPeriods: [],
    costSamples: [],
    seenMessageIds: new Set()
  }
}

function cloneMeta(prev, fileSize, mtime) {
  return {
    ...prev, fileSize, mtime,
    tokens: { ...prev.tokens },
    tokensByModel: Object.fromEntries(Object.entries(prev.tokensByModel).map(([k, v]) => [k, { ...v }])),
    tokensByModelFast: Object.fromEntries(Object.entries(prev.tokensByModelFast).map(([k, v]) => [k, { ...v }])),
    serverToolUse: { ...prev.serverToolUse },
    activityPeriods: prev.activityPeriods.map((p) => ({ ...p })),
    costSamples: (prev.costSamples || []).slice(),
    seenMessageIds: new Set(prev.seenMessageIds || [])
  }
}

export class SessionParser {
  constructor({ sessionId, parentSessionId, filePath, fileSize = 0, mtime = 0, pricing = null, prev = null, range = null, excludeIds = null }) {
    this.range = range
    this.excludeIds = excludeIds
    this.pricing = pricing
    // Per-stream state for stamping items with running totals; not part of meta.
    this.prevMessage = null
    this.tokenTotal = 0
    this.lastSeenTs = null
    // msgId -> the usage bucket we've already folded into the totals, so later
    // snapshots of a streamed reply can contribute only their growth.
    this.appliedById = new Map()
    // excludeIds disables incremental reuse — the exclusion changes the totals.
    const reuse = prev && fileSize >= prev.fileSize && !excludeIds
    this.reused = reuse
    this.meta = reuse
      ? cloneMeta(prev, fileSize, mtime)
      : freshMeta({ sessionId, parentSessionId, filePath, fileSize, mtime })
  }

  get startOffset() {
    return this.reused ? this.meta.nextOffset : 0
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
      if (!meta.forkedFrom && obj.forkedFrom?.sessionId) meta.forkedFrom = obj.forkedFrom
      const text = extractText(obj.message?.content)
      if (text.startsWith('<command-name>') || text.startsWith('<command-message>')) {
        if (!meta.firstUserCommand) meta.firstUserCommand = text
      } else if (text.startsWith('<local-command-stdout>')) {
        // stdout arrives as a separate message after the command-name entry
        if (meta.firstUserCommand) meta.firstUserCommand += '\n' + text
      } else if (text.startsWith('<scheduled-task')) {
        meta.hasScheduledTask = true
      } else if (text && !text.startsWith('<local-command-caveat>')) {
        if (!meta.firstUserPrompt) meta.firstUserPrompt = text.slice(0, 300)
      }
    } else if (t === 'assistant') {
      const msg = obj.message
      // Skip local error/limit notices (e.g. "limit reached") — not real model calls.
      if (!msg || msg.model === '<synthetic>') return true
      if (msg.model) {
        if (!meta.model) meta.model = msg.model
        if (!meta.models.includes(msg.model)) meta.models.push(msg.model)
      }
      this._recordUsage(obj)
    }
    this.prevMessage = obj
    return true
  }

  // One assistant reply is written as several jsonl lines sharing message.id:
  // input/cache stay fixed while output_tokens grows toward its final value. We
  // add each line's *growth* over the previous one (the full usage on the first
  // line), so the totals land on the final value — what ccusage bills. The
  // per-item running-total stamps and the stream-stable metadata come only from
  // the first line; ids in `excludeIds` (already counted in an earlier
  // resumed-from session) stamp but never aggregate.
  // (`appliedById` is per-stream, not persisted, so a reply whose lines straddle a
  // live incremental rescan can briefly undercount; the next full re-scan fixes it.)
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
      // Input tokens attribute to the turn that *caused* the call (user prompt or
      // tool_result) — the model is billed for reading the preceding turn.
      const inputTarget = this.prevMessage && this.prevMessage._tokenDelta == null ? this.prevMessage : obj
      this.tokenTotal += contextSize
      inputTarget._tokenDelta = (inputTarget._tokenDelta || 0) + contextSize
      inputTarget._tokenTotal = this.tokenTotal
      this.tokenTotal += usage.output
      obj._tokenDelta = (obj._tokenDelta || 0) + usage.output
      obj._tokenTotal = this.tokenTotal
    }
    if (this.excludeIds?.has(msgId)) return

    const applied = this.appliedById.get(msgId)
    if (!applied) { // first non-excluded line of this reply — record stream-stable metadata once
      meta.lastContextTokens = contextSize // prompt size on this turn; last assistant message wins
      if (u.service_tier) meta.serviceTier = u.service_tier
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
    const stdCost  = this.pricing ? this.pricing.costUSD(meta.tokensByModel) : 0
    const fastCost = this.pricing ? this.pricing.costUSD(meta.tokensByModelFast, { fast: true }) : 0
    meta.cost = (stdCost || 0) + (fastCost || 0)
    // What the session would have cost with only 5m cache (no 1h premium); the gap is the potential saving.
    const stdNo1h  = this.pricing ? this.pricing.costUSD(meta.tokensByModel, { ignoreCache1hPremium: true }) : 0
    const fastNo1h = this.pricing ? this.pricing.costUSD(meta.tokensByModelFast, { ignoreCache1hPremium: true, fast: true }) : 0
    meta.savings = { using5mCache: meta.cost - ((stdNo1h || 0) + (fastNo1h || 0)) }
    return meta
  }
}

