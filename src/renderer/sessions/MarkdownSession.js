import { format } from 'date-fns'
import { fmtDuration, fmtNum, fmtUSD, fmtCompact, fmtToolCalls } from '../utils/formatting.js'
import { flatten, currentModel, contextWindow } from './view/transcript.js'
import { toolSummary, instructionTitle, groupInstructions, compactTitle } from './view/labels.js'

export const MAX_LINES = 10
export const MAX_LINE_CHARS = 200
let MODEL = null // the conversation's model, for instructionTitle

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
  if (b.type === 'thinking') return b.redacted ? `_Thinking (encrypted${b.redacted > 1 ? ` · ${b.redacted}` : ''})_` : `Thinking:\n${fence(b.thinking)}`
  if (b.type === 'tool_use') {
    const tail = b.result ? `\n${b.result.is_error ? 'error' : 'result'}:\n${fence(resultText(b.result))}` : ''
    const title = toolSummary(b.name, b.input)
    return `[${title}]\n${fence(JSON.stringify(b.input, null, 2), 'json')}${tail}`
  }
  if (b.type === 'tool_result') return `${b.is_error ? 'error' : 'result'}:\n${fence(resultText(b))}`
  if (b.type === 'skill') return `Skill${b.name ? `: ${b.name}` : ''}:\n${fence(b.text)}`
  if (b.type === 'system') return `_${b.title}_${b.url ? ` (${b.url})` : ''}${b.body ? `\n${fence(b.body)}` : ''}`
  if (b.type === 'image') return '[image]'
  if (b.type === 'instruction') {
    const it = b.it
    const path = it.name && it.name !== it.file_path ? `\n\`${it.file_path}\`` : ''
    return `_${instructionTitle(it, MODEL)}_${path}\n${fence(it.error ? `error: ${it.error}` : (it.content || ''))}`
  }
  return fence(JSON.stringify(b, null, 2), 'json')
}

function renderTurn(t) {
  if (t.role === 'instruction') {
    return '**Proxy:**\n\n' + groupInstructions(t.blocks.map(b => b.it))
      .map(([label, list]) => `**Instructions loaded (${label}):**\n\n${list.map(it => renderBlock({ type: 'instruction', it })).join('\n\n')}`)
      .join('\n\n')
  }
  if (t.role === 'compact') {
    const b = t.blocks[0]
    return `**${compactTitle(b)}**${b.summary ? `\n\nSummary:\n${fence(b.summary)}` : ''}`
  }
  const role = t.role === 'system' ? 'System' : t.role === 'user' ? (t.queued ? 'User (queued)' : 'User') : `Assistant`
  const tokens = t.tokenTotal > 0 && t.tokenDelta != null
    ? ` (${t.tokenDelta >= 0 ? '+' : ''}${fmtCompact(t.tokenDelta)} / ${fmtCompact(t.tokenTotal)} tokens)`
    : ''
  return `**${role}${tokens}:**\n\n${t.blocks.map(renderBlock).join('\n\n')}`
}

export function markdownSession(meta, items, instructions = []) {
  const t = meta.tokens
  const stu = meta.serverToolUse
  const wallDuration = meta.lastActivityAt - meta.startedAt
  const ctxLimit = contextWindow(meta.models)
  const contextPct = Math.round((meta.lastContextTokens / ctxLimit) * 100)
  const cacheHitPct = (meta.cacheHitRatio * 100).toFixed(0)
  const turns = items ? flatten(items, instructions) : null
  MODEL = turns ? currentModel(turns) : null
  const transcript = turns ? turns.map(renderTurn).join('\n\n---\n\n') : '_Loading…_'
  const conversation = `\n# Conversation\n\n${transcript}`

  const summary = `
# Session: ${meta.sessionId}

# Summary
- Estimated cost: ${fmtUSD(meta.cost)}
- Total tokens: ${fmtCompact(meta.totalTokens)}
- Working time: ${fmtDuration(meta.activeMs)}
- Context size: ${fmtCompact(meta.lastContextTokens)} / ${fmtCompact(ctxLimit)} (${contextPct}%)${meta.savings.using5mCache > 0 ? `

## Potential savings
- with 5m cache: ${meta.cost > 0 ? `(${(meta.savings.using5mCache / meta.cost * 100).toFixed(0)}%) ` : ''}−${fmtUSD(meta.savings.using5mCache)}` : ''}

## Tokens
- Input: ${fmtNum(t.input)}
- Output: ${fmtNum(t.output)}
- Cache write (5m): ${fmtNum(t.cacheCreation5m || 0)}
- Cache write (1h): ${fmtNum(t.cacheCreation1h || 0)}
- Cache read: ${fmtNum(t.cacheRead)}
- Cache hit ratio: ${cacheHitPct}%
- Server tools (search / fetch): ${fmtNum(stu.webSearch)} / ${fmtNum(stu.webFetch)}

## Activity
${meta.continuesFrom ? `- Continues from: ${format(meta.continuesFrom, 'PPpp')} (earlier messages not included)
` : ''}- Started: ${format(meta.startedAt, 'pp')}
- Last activity: ${format(meta.lastActivityAt, 'pp')}
${meta.continuesTo ? `- Continues on: ${format(meta.continuesTo, 'PPpp')} (later messages not included)
` : ''}- Wall duration: ${fmtDuration(wallDuration)}
- Active periods: ${fmtNum(meta.activityPeriods.length)}
- Messages: ${fmtNum(meta.messageCount)}
- Tool calls: ${fmtToolCalls(meta)}

## Identity
- Session ID: ${meta.sessionId}
- Model: ${meta.models.join(', ') || '—'}
- Effort: ${meta.efforts.join(', ') || '—'}
- Service tier: ${meta.serviceTier || '—'}
- Speed: ${meta.speed ? (meta.speed === 'fast' ? (meta.fastPricingUnknown ? 'fast (pricing unknown)' : 'fast') : meta.speed) : '—'}
${meta.tag ? `- Tag: ${meta.tag}
` : ''}- Git branch: ${meta.gitBranch || '—'}
- Source: ${meta.source || meta.entrypoint || '—'}
- Scheduled: ${meta.hasScheduledTask ? 'yes' : 'no'}
- CLI version: ${meta.version || '—'}
- Project: ${meta.project || '—'}
${meta.subdir ? `- Subfolder: ${meta.subdir}\n` : ''}${meta.worktreePath ? `- Worktree: ${meta.worktreePath}\n` : ''}${meta.tempPath ? `- Temp dir: ${meta.tempPath}\n` : ''}- Log file: ${meta.filePath}
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
