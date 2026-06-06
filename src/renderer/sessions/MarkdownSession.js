import { format } from 'date-fns'
import { fmtDuration, fmtBytes, fmtNum, fmtUSD, fmtCompact } from '../utils/formatting.js'
import { THRESHOLDS as T } from '../utils/thresholds.js'
import { flatten } from './view/ConversationView.jsx'

const CONTEXT_WINDOW = T.context.danger
let MAX_LINES = 10
let MAX_LINE_CHARS = 200

function truncateLine(line) {
  if (line.length <= MAX_LINE_CHARS) return line
  return line.slice(0, MAX_LINE_CHARS) + ` …(${line.length - MAX_LINE_CHARS} chars truncated)`
}

function truncate(text) {
  const lines = String(text ?? '').split('\n').map(truncateLine)
  if (lines.length <= MAX_LINES) return lines.join('\n')
  return lines.slice(0, MAX_LINES).join('\n') + `\n--- ${lines.length - MAX_LINES} lines truncated ---`
}

function fence(text, lang = '') {
  return '```' + lang + '\n' + truncate(text) + '\n```'
}

function resultText(r) {
  const parts = Array.isArray(r?.content) ? r.content : [r?.content]
  return parts.map(p => typeof p === 'string' ? p : (p?.text ?? JSON.stringify(p))).join('\n')
}

function renderBlock(b) {
  if (b.type === 'text') return truncate(b.text || '')
  if (b.type === 'thinking') return `thinking:\n${fence(b.thinking || '')}`
  if (b.type === 'tool_use') {
    const tail = b.result ? `\n${b.result.is_error ? 'error' : 'result'}:\n${fence(resultText(b.result))}` : ''
    return `[${b.name}]\n${fence(JSON.stringify(b.input, null, 2), 'json')}${tail}`
  }
  if (b.type === 'tool_result') return `${b.is_error ? 'error' : 'result'}:\n${fence(resultText(b))}`
  if (b.type === 'image') return '[image]'
  if (b.type === 'instruction') {
    const it = b.it
    return `_${it.file_path} (${it.memory_type})_\n${fence(it.error ? `error: ${it.error}` : (it.content || ''))}`
  }
  return fence(JSON.stringify(b, null, 2), 'json')
}

function renderTurn(t) {
  if (t.role === 'instruction') return `**Instructions loaded:**\n\n${t.blocks.map(renderBlock).join('\n\n')}`
  const role = t.role === 'user' ? 'User' : `Assistant`
  const tokens = t.tokenTotal > 0 && t.tokenDelta != null
    ? ` (${t.tokenDelta >= 0 ? '+' : ''}${fmtCompact(t.tokenDelta)} / ${fmtCompact(t.tokenTotal)} tokens)`
    : ''
  return `**${role}${tokens}:**\n\n${t.blocks.map(renderBlock).join('\n\n')}`
}

export const TRUNCATE_LINES = 10
export const TRUNCATE_LINE_CHARS = 200

export function markdownSession(meta, items, truncated) {
  MAX_LINES = truncated ? TRUNCATE_LINES : Infinity
  MAX_LINE_CHARS = truncated ? TRUNCATE_LINE_CHARS : Infinity
  const t = meta.tokens
  const stu = meta.serverToolUse
  const wallDuration = meta.lastActivityAt - meta.startedAt
  const contextPct = Math.round((meta.lastContextTokens / CONTEXT_WINDOW) * 100)
  const cacheHitPct = (meta.cacheHitRatio * 100).toFixed(0)
  const transcript = items
    ? flatten(items).map(renderTurn).join('\n\n---\n\n')
    : '_Loading…_'
  const conversation = `\n# Conversation\n\n${transcript}`

  const summary = `
# Session: ${meta.sessionId}

# Summary
- Working time: ${fmtDuration(meta.activeMs)}
- Total tokens: ${fmtCompact(meta.totalTokens)}
- Estimated cost: ${fmtUSD(meta.cost)}
- Context size: ${fmtCompact(meta.lastContextTokens)} / ${fmtCompact(CONTEXT_WINDOW)} (${contextPct}%)

## Tokens
- Input: ${fmtNum(t.input)}
- Output: ${fmtNum(t.output)}
- Cache write (5m): ${fmtNum(t.cacheCreation5m || 0)}
- Cache write (1h): ${fmtNum(t.cacheCreation1h || 0)}
- Cache read: ${fmtNum(t.cacheRead)}
- Cache hit ratio: ${cacheHitPct}%
- Server tools (search / fetch): ${fmtNum(stu.webSearch)} / ${fmtNum(stu.webFetch)}

## Activity
- Started: ${format(meta.startedAt, 'pp')}
- Last activity: ${format(meta.lastActivityAt, 'pp')}
- Wall duration: ${fmtDuration(wallDuration)}
- Active periods: ${fmtNum(meta.activityPeriods.length)}
- Messages: ${fmtNum(meta.messageCount)}

## Identity
- Model: ${meta.models.join(', ') || '—'}
- Service tier: ${meta.serviceTier || '—'}
- Speed: ${meta.speed ? (meta.speed === 'fast' ? (meta.fastPricingUnknown ? 'fast (pricing unknown)' : 'fast') : meta.speed) : '—'}
- Git branch: ${meta.gitBranch || '—'}
- Source: ${meta.source || meta.entrypoint || '—'}
- Scheduled: ${meta.hasScheduledTask ? 'yes' : 'no'}
- CLI version: ${meta.version || '—'}
- Project: ${meta.project || '—'}
${meta.worktreePath ? `- Worktree: ${meta.worktreePath}\n` : ''}- Log file: ${meta.filePath}
- File size: ${fmtBytes(meta.fileSize)}
`

  const body = `
<summary>
${summary}
</summary>


<transcript>
${conversation}
</transcript>`.trim()

  return { body }
}
