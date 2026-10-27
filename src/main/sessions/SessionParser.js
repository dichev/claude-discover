const ACTIVITY_GAP_MS = 5 * 60 * 1000
const TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'cacheCreation', 'cacheCreation5m', 'cacheCreation1h']

function emptyBucket() {
  return Object.fromEntries(TOKEN_FIELDS.map(k => [k, 0]))
}

// Each token type's slice of a bucket, priced alone; rates are linear, so the slices' costs sum to the bucket's
const COST_PARTS = {
  input: b => ({ input: b.input }),
  output: b => ({ output: b.output }),
  cacheRead: b => ({ cacheRead: b.cacheRead }),
  cacheWrite: b => ({ cacheCreation: b.cacheCreation - b.cacheCreation1h, cacheCreation5m: b.cacheCreation5m }),
  cacheWrite1h: b => ({ cacheCreation: b.cacheCreation1h, cacheCreation1h: b.cacheCreation1h }),
}
const pickParts = (byModel, part) => Object.fromEntries(Object.entries(byModel).map(([m, b]) => [m, part(b)]))

function addUsage(target, delta) {
  for (const k of TOKEN_FIELDS) target[k] += delta[k]
}

function extractText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(b => (typeof b === 'string' ? b : b?.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n')
}

function shortProject(dir, depth) {
  if (!dir) return '(no project)'
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-depth).join('/') || dir
}

// Labels a set of dirs by their folder name, with the parent folder added where two share one
// (work/forge vs pesho/forge, while /users/dev/app stays app).
export function suffixLabels(dirs) {
  const labels = new Map([...new Set(dirs)].map(dir => [dir, shortProject(dir, 1)]))
  const counts = new Map()
  for (const label of labels.values()) counts.set(label, (counts.get(label) ?? 0) + 1)
  for (const [dir, label] of labels) if (counts.get(label) > 1) labels.set(dir, shortProject(dir, 2))
  return labels
}

function classifySource(meta) {
  if (meta.hasScheduledTask) return 'scheduled'
  return (meta.entrypoint || '').toLowerCase() || 'other'
}

function freshMeta({ sessionId, parentSessionId, filePath, parentFilePath, fileSize, mtime }) {
  return {
    sessionId, parentSessionId, filePath, parentFilePath, fileSize, mtime,
    entrypoint: null, project: null, gitBranch: null, version: null,
    summary: null, aiTitle: null, customTitle: null, agentName: null, tag: null, forkedFrom: null, forkedAt: null,
    ...freshMetrics(),
  }
}

// What the records add up to — a branch resets it where its own records start
function freshMetrics() {
  return {
    startedAt: null, lastActivityAt: null, continuesFrom: null, continuesTo: null,
    model: null, models: [], efforts: [], serviceTier: null, speed: null, fastPricingUnknown: false, priceUnknown: false,
    firstUserPrompt: null, firstUserCommand: null,
    messageCount: 0, workflowAgents: 0, toolCalls: 0, skillCalls: 0,
    tokens: emptyBucket(), tokensByModel: {}, tokensByModelFast: {}, lastContextTokens: 0,
    serverToolUse: { webSearch: 0, webFetch: 0 },
    hasScheduledTask: false,
    activityPeriods: [],
    costSamples: [],
    seenMessageIds: new Set()
  }
}

export class SessionParser {
  constructor({ sessionId, parentSessionId, filePath, parentFilePath = null, fileSize = 0, mtime = 0, pricing = null, range = null, excludeIds = null }) {
    this.range = range
    this.excludeIds = excludeIds
    this.pricing = pricing
    this.meta = freshMeta({ sessionId, parentSessionId, filePath, parentFilePath, fileSize, mtime })
    // Per-stream state for stamping items with running totals; not part of meta.
    this.prevMessage = null
    this.tokenTotal = 0
    this.lastSeenTs = null
    this.modelId = null
    this.commandUuids = new Set()
    this.seenUuids = new Set()
    this.typedCommands = new Map() // `${promptId} /name` -> the record of it as typed
    // msgId -> the usage bucket we've already folded into the totals, so later
    // snapshots of a streamed reply can contribute only their growth.
    this.appliedById = new Map()
    this.branchStarted = false
  }

  // Returns true if the item passes `this.range`.
  feed(obj) {
    const meta = this.meta
    const t = obj.type
    // A branch opens with its source's records copied over, each stamped `forkedFrom` — they show in it but count only in the source
    if (obj.forkedFrom?.sessionId) {
      meta.forkedFrom ??= obj.forkedFrom
      meta.forkedAt = Math.max(meta.forkedAt ?? 0, Date.parse(obj.timestamp) || 0)
    } else if (meta.forkedAt != null && !this.branchStarted) {
      this.branchStarted = true
      this.resetMetrics()
    }
    if (t === 'summary' && obj.summary) meta.summary = obj.summary
    if (t === 'ai-title' && obj.aiTitle) meta.aiTitle = obj.aiTitle
    if (t === 'custom-title' && obj.customTitle) meta.customTitle = obj.customTitle
    if (t === 'agent-name' && obj.agentName) meta.agentName = obj.agentName
    if (t === 'tag') meta.tag = obj.tag || null // last one wins; an empty tag clears it
    if (t === 'queue-operation' && obj.content?.includes('<scheduled-task')) meta.hasScheduledTask = true
    if (t === 'started' && obj.key && obj.agentId) meta.workflowAgents += 1 // workflow journal: one `started` record per agent() call
    if (t === 'attachment' && obj.attachment?.type === 'model') this.modelId = obj.attachment.identity?.modelId

    if (obj.cwd && !meta.project) meta.project = obj.cwd
    if (obj.gitBranch && !meta.gitBranch) meta.gitBranch = obj.gitBranch
    if (obj.entrypoint && !meta.entrypoint) meta.entrypoint = obj.entrypoint
    if (obj.version && !meta.version) meta.version = obj.version

    // Untimestamped events (permission-mode, ai-title, last-prompt, …) inherit the previous timestamped event's ts; if none has been seen yet, fall back to file mtime — but don't let that mtime fallback extend session bounds (mtime can be much later than the real events, e.g. when the file is touched by an unrelated process).
    const parsed = obj.timestamp && Date.parse(obj.timestamp)
    const inherited = parsed > 0 ? parsed : this.lastSeenTs
    const ts = inherited ?? meta.mtime
    if (parsed > 0) this.lastSeenTs = parsed
    if (this.range && (ts < this.range.start || ts > this.range.end)) {
      // Nearest activity outside the period on either side — the view marks where the shown part picks up and where it goes on
      if (inherited != null && ts < this.range.start && ts > meta.continuesFrom) meta.continuesFrom = ts
      if (inherited != null && ts > this.range.end && (meta.continuesTo == null || ts < meta.continuesTo)) meta.continuesTo = ts
      return false
    }
    obj._ts = ts
    if (inherited != null) {
      if (meta.startedAt == null || inherited < meta.startedAt) meta.startedAt = inherited
      if (inherited > meta.lastActivityAt) meta.lastActivityAt = inherited
    }
    // Partial compaction re-logs records under their original uuids — count once, but keep the copy for the JSONL view
    if (obj.uuid) {
      if (this.seenUuids.has(obj.uuid)) {
        obj._relogged = true
        return true
      }
      this.seenUuids.add(obj.uuid)
    }

    // Standalone attachment entries are harness-injected context
    // (diagnostics, task_reminder, selected_lines_in_ide, etc.), except for a queued command.
    // Never input targets: they trail the prompt they ride with, which should carry the call's input.
    if (t === 'attachment') {
      obj.isMeta = true
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
      // A skill run as a slash command has no Skill call — only its body record marks it. Other
      // companions (e.g. the "no visible output" nudge) hang off an assistant turn instead.
      if (obj.turnCompanion && !obj.sourceToolUseID && this.commandUuids.has(obj.parentUuid)) meta.skillCalls += 1
      this._feedUser(obj)
    } else if (t === 'assistant') {
      const msg = obj.message
      // Skip local error/limit notices (e.g. "limit reached") — not real model calls.
      if (!msg || msg.model === '<synthetic>') return true
      // The API echoes the bare id; a variant like claude-opus-5-5[1m] is named only in Claude Code's `model` attachment.
      // Display only — pricing keeps msg.model.
      const model = this.modelId?.replace(/\[.*\]$/, '') === msg.model ? this.modelId : msg.model
      if (model) {
        if (!meta.model) meta.model = model
        if (!meta.models.includes(model)) meta.models.push(model)
      }
      // Older CLIs log only `effort`; newer ones add `perTurnEffort` (sometimes null) for the level actually sent.
      const effort = obj.perTurnEffort ?? obj.effort
      if (effort && !meta.efforts.includes(effort)) meta.efforts.push(effort)
      // tool_use blocks stream across a reply's lines without repeating, so a plain per-line sum is exact.
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b?.type !== 'tool_use') continue
          meta.toolCalls += 1
          if (b.name === 'Skill') meta.skillCalls += 1
        }
      }
      this._recordUsage(obj)
    }
    this.prevMessage = obj
    return true
  }

  // Forgets what the records so far added up to, but not the running totals the view stamps
  resetMetrics() {
    Object.assign(this.meta, freshMetrics())
    this.lastSeenTs = null
    this.appliedById.clear()
  }

  // Capture the first user prompt / command for the session list.
  _feedUser(obj) {
    const meta = this.meta
    const text = extractText(obj.message?.content)
    if (text.startsWith('<command-name>') || text.startsWith('<command-message>')) {
      if (!meta.firstUserCommand) meta.firstUserCommand = text
      if (obj.uuid) this.commandUuids.add(obj.uuid)
      obj.isMeta = true
      // Some commands (/compact) also log the text as typed, under the same promptId — the command shows it
      const typed = this.typedCommands.get(`${obj.promptId} ${text.match(/<command-name>(.*?)<\/command-name>/)?.[1]}`)
      if (typed && !typed._relogged) {
        typed._relogged = true
        meta.messageCount -= 1
      }
    } else if (text.startsWith('<local-command-stdout>')) {
      // stdout arrives as a separate message after the command-name entry
      if (meta.firstUserCommand) meta.firstUserCommand += '\n' + text
      obj.isMeta = true
    } else if (text.startsWith('<local-command-caveat>')) {
      // CLI-injected wrapper note, not real user content
      obj.isMeta = true
    } else if (text.startsWith('<scheduled-task')) {
      meta.hasScheduledTask = true
    } else if (text && !obj.isMeta && !obj.isCompactSummary) { // meta records (e.g. a slash-command skill's body) and compaction summaries aren't typed by the user
      if (obj.promptId && text.startsWith('/')) this.typedCommands.set(`${obj.promptId} ${text.split(/\s/)[0]}`, obj)
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

  // One assistant reply spans several jsonl lines sharing message.id, with output_tokens growing
  // toward its final value. Counting each line's *growth* lands the totals on that final value —
  // what ccusage bills. Ids in `excludeIds` (already counted in a resumed-from session) never aggregate.
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
    const growth = emptyBucket()
    let changed = false
    // Never go negative: a rewind can repeat a line with its usage zeroed, but those tokens were still billed.
    for (const k of TOKEN_FIELDS) { growth[k] = Math.max(0, usage[k] - (applied?.[k] ?? 0)); if (growth[k] !== 0) changed = true }
    if (applied) addUsage(applied, growth)
    else this.appliedById.set(msgId, usage)
    if (!changed) return // a repeat line that added nothing
    // Fast and standard tokens price differently, so keep separate per-model buckets.
    const byModel = fast ? meta.tokensByModelFast : meta.tokensByModel
    addUsage(meta.tokens, growth)
    addUsage(byModel[model] ??= emptyBucket(), growth)
    const cost = this.pricing && obj._ts != null ? this.pricing.costForDelta(model, growth, { fast }) : null
    if (obj._ts != null) {
      const prevTs = this.prevMessage?._ts
      const tokens = growth.input + growth.output + growth.cacheRead + growth.cacheCreation
      meta.costSamples.push({ start: prevTs != null && prevTs < obj._ts ? prevTs : obj._ts, end: obj._ts, cost: cost || 0, tokens })
    }
  }

  finalize(mtimeFallback) {
    const meta = this.meta
    if (meta.startedAt == null) meta.startedAt = mtimeFallback
    if (meta.lastActivityAt == null) meta.lastActivityAt = mtimeFallback
    meta.source = classifySource(meta)
    meta.activeMs = meta.activityPeriods.reduce((sum, p) => sum + Math.max(0, p.end - p.start), 0)
    const t = meta.tokens
    meta.totalTokens = t.input + t.output + t.cacheRead + t.cacheCreation
    const cacheDenom = t.cacheRead + t.cacheCreation
    meta.cacheHitRatio = cacheDenom > 0 ? t.cacheRead / cacheDenom : null
    const costOf = (opts, part = b => b) => !this.pricing ? 0
      : (this.pricing.costUSD(pickParts(meta.tokensByModel, part), opts) || 0)
        + (this.pricing.costUSD(pickParts(meta.tokensByModelFast, part), { ...opts, fast: true }) || 0)
    meta.cost = costOf({})
    meta.costByType = Object.fromEntries(Object.entries(COST_PARTS).map(([type, part]) => [type, costOf({}, part)]))
    // What the session would have cost with only 5m cache (no 1h premium); the gap is the potential saving.
    meta.savings = { using5mCache: meta.cost - costOf({ ignoreCache1hPremium: true }) }
    return meta
  }
}

