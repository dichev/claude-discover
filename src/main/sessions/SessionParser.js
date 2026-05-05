import { costUSD } from '../services/Pricing.js'

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

function shortCwd(cwd) {
  if (!cwd) return '(no cwd)'
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/') || cwd
}

function classifySource(meta) {
  if (meta.hasScheduledTask) return 'scheduled'
  const ep = (meta.entrypoint || '').toLowerCase()
  if (ep === 'cli') return 'cli'
  if (ep.includes('desktop')) return 'desktop'
  if (ep.includes('sdk')) return 'sdk'
  return 'other'
}

function freshMeta({ sessionId, parentSessionId, filePath, fileSize, mtime }) {
  return {
    sessionId, parentSessionId, filePath, fileSize, mtime,
    startedAt: null, lastActivityAt: null,
    entrypoint: null, cwd: null, gitBranch: null, version: null,
    model: null, models: [], serviceTier: null,
    summary: null, aiTitle: null, customTitle: null, agentName: null, firstUserPrompt: null, firstUserCommand: null, forkedFrom: null,
    messageCount: 0,
    tokens: emptyBucket(), tokensByModel: {}, lastContextTokens: 0,
    serverToolUse: { webSearch: 0, webFetch: 0 },
    hasScheduledTask: false,
    activityPeriods: [],
    seenMessageIds: new Set()
  }
}

function cloneMeta(prev, fileSize, mtime) {
  return {
    ...prev, fileSize, mtime,
    tokens: { ...prev.tokens },
    tokensByModel: Object.fromEntries(Object.entries(prev.tokensByModel).map(([k, v]) => [k, { ...v }])),
    serverToolUse: { ...prev.serverToolUse },
    activityPeriods: prev.activityPeriods.map((p) => ({ ...p })),
    seenMessageIds: new Set(prev.seenMessageIds || [])
  }
}

// One assistant reply spans several jsonl lines that share message.id + usage —
// count only first sight. `excludeIds` skips ids already counted in an earlier
// (resumed-from) session.
function recordDedupedUsage(meta, msg, excludeIds) {
  const u = msg?.usage
  const msgId = msg?.id
  if (!u || !msgId || meta.seenMessageIds.has(msgId)) return
  meta.seenMessageIds.add(msgId)
  if (excludeIds?.has(msgId)) return
  const cc = u.cache_creation || {}
  const delta = {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheCreation: u.cache_creation_input_tokens || 0,
    cacheCreation5m: cc.ephemeral_5m_input_tokens || 0,
    cacheCreation1h: cc.ephemeral_1h_input_tokens || 0,
  }
  addUsage(meta.tokens, delta)
  // Prompt size on this turn — overwritten each assistant message so the last wins.
  meta.lastContextTokens = delta.input + delta.cacheRead + delta.cacheCreation
  if (u.service_tier) meta.serviceTier = u.service_tier
  if (u.server_tool_use) {
    meta.serverToolUse.webSearch += u.server_tool_use.web_search_requests || 0
    meta.serverToolUse.webFetch += u.server_tool_use.web_fetch_requests || 0
  }
  const model = msg.model || 'unknown'
  addUsage(meta.tokensByModel[model] || (meta.tokensByModel[model] = emptyBucket()), delta)
}

export class SessionParser {
  constructor({ sessionId, parentSessionId, filePath, fileSize, mtime, prev = null, range = null, excludeIds = null }) {
    this.range = range
    this.excludeIds = excludeIds
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

  feed(obj) {
    const meta = this.meta
    const t = obj.type
    if (t === 'summary' && obj.summary) { meta.summary = obj.summary; return }
    if (t === 'ai-title' && obj.aiTitle) { meta.aiTitle = obj.aiTitle; return }
    if (t === 'custom-title' && obj.customTitle) { meta.customTitle = obj.customTitle; return }
    if (t === 'agent-name' && obj.agentName) { meta.agentName = obj.agentName; return }
    if (t === 'queue-operation' && obj.content?.includes('<scheduled-task')) {
      meta.hasScheduledTask = true
      return
    }

    if (obj.cwd && !meta.cwd) meta.cwd = obj.cwd
    if (obj.gitBranch && !meta.gitBranch) meta.gitBranch = obj.gitBranch
    if (obj.entrypoint && !meta.entrypoint) meta.entrypoint = obj.entrypoint
    if (obj.version && !meta.version) meta.version = obj.version

    const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN
    const tsValid = !Number.isNaN(ts)
    if (this.range && (!tsValid || ts < this.range.start || ts > this.range.end)) return
    if (tsValid) {
      if (meta.startedAt == null || ts < meta.startedAt) meta.startedAt = ts
      if (ts > meta.lastActivityAt) meta.lastActivityAt = ts
    }

    if (t !== 'user' && t !== 'assistant') return
    meta.messageCount += 1

    if (tsValid) {
      const last = meta.activityPeriods[meta.activityPeriods.length - 1]
      if (last && ts - last.end <= ACTIVITY_GAP_MS) {
        if (ts > last.end) last.end = ts
      } else {
        meta.activityPeriods.push({ start: ts, end: ts })
      }
    }

    if (t === 'user') {
      if (!meta.forkedFrom && obj.forkedFrom?.sessionId) {
        meta.forkedFrom = obj.forkedFrom
      }
      const text = extractText(obj.message?.content)
      if (text) {
        if (text.startsWith('<command-name>') || text.startsWith('<command-message>')) {
          if (!meta.firstUserCommand) meta.firstUserCommand = text
        }
        else if (text.startsWith('<local-command-stdout>')) { // this is sent as a separate message
          if (meta.firstUserCommand) meta.firstUserCommand += '\n' + text
        }
        else if (text.startsWith('<local-command-caveat>')) {
          // skip
        }
        else if (text.startsWith('<scheduled-task')) {
           meta.hasScheduledTask = true
        }
        else {
           if (!meta.firstUserPrompt)  meta.firstUserPrompt = text.slice(0, 300)
        }
      }


    } else if (t === 'assistant') {
      const msg = obj.message
      // Skip local error/limit notices (e.g. "limit reached") — not real model calls.
      if (!msg || msg.model === '<synthetic>') return
      if (msg.model) {
        if (!meta.model) meta.model = msg.model
        if (!meta.models.includes(msg.model)) meta.models.push(msg.model)
      }
      recordDedupedUsage(meta, msg, this.excludeIds)
    }
  }

  finalize(mtimeFallback) {
    const meta = this.meta
    if (meta.startedAt == null) meta.startedAt = mtimeFallback
    if (meta.lastActivityAt == null) meta.lastActivityAt = mtimeFallback
    meta.source = classifySource(meta)
    meta.cwdShort = shortCwd(meta.cwd)
    meta.activeMs = meta.activityPeriods.reduce((sum, p) => sum + Math.max(0, p.end - p.start), 0)
    const t = meta.tokens
    meta.totalTokens = t.input + t.output + t.cacheRead + t.cacheCreation
    const cacheDenom = t.cacheRead + t.cacheCreation
    meta.cacheHitRatio = cacheDenom > 0 ? t.cacheRead / cacheDenom : null
    meta.cost = costUSD(meta.tokensByModel)
    return meta
  }
}

export async function scanSession(reader, { prev = null, range = null, excludeIds = null, stat = null } = {}) {
  if (!stat) stat = await reader.stat()
  if (!stat) return null
  const parser = new SessionParser({
    sessionId: reader.sessionId,
    parentSessionId: reader.parentSessionId,
    filePath: reader.filePath,
    fileSize: stat.size,
    mtime: stat.mtimeMs,
    prev, range, excludeIds,
  })
  const nextOffset = await reader.streamFrom(parser.startOffset, (obj) => parser.feed(obj))
  const meta = parser.finalize(stat.mtimeMs)
  meta.nextOffset = nextOffset
  return meta
}

// Resume/fork copies prior message.ids verbatim. Walk earliest-first; if a
// session's ids overlap one already counted, rescan it with the overlap
// excluded so it contributes only its NEW messages.
export async function dedupAcrossSessions(metas, rescan) {
  const sorted = [...metas].sort((a, b) => a.startedAt - b.startedAt)
  const globalSeen = new Set()
  const overlaps = []
  for (const m of sorted) {
    let overlap = null
    for (const id of m.seenMessageIds || []) {
      if (globalSeen.has(id)) (overlap ||= new Set()).add(id)
      globalSeen.add(id)
    }
    overlaps.push(overlap)
  }
  const rescanned = await Promise.all(sorted.map((m, i) => overlaps[i] ? rescan(m, overlaps[i]) : null))
  const adjusted = new Map()
  sorted.forEach((m, i) => adjusted.set(m.sessionId, rescanned[i] ? { ...m, ...rescanned[i] } : m))
  return metas.map((m) => adjusted.get(m.sessionId) || m)
}
