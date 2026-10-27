import { format } from 'date-fns'
import { fmtDuration, fmtNum, fmtUSD, fmtCompact, fmtToolCalls } from '../utils/formatting.js'
import { flatten, groupTurns, branchPoint, contextSize, currentModel, contextWindow, countTokens } from './view/transcript.js'
import { toolSummary, parseCommand, isClearTurn, instructionTitle, compactTitle, attachmentView, hasText, safeJson, SIDE_NOTE } from './view/labels.js'
import { fenced } from '../utils/textBlock.js'
import { cacheAdvice, CACHE_LABELS } from '../utils/cacheAdvice.js'

export const MAX_LINES = 10
export const MAX_LINE_CHARS = 200

function truncateLine(line) {
  if (line.length <= MAX_LINE_CHARS) return line
  return line.slice(0, MAX_LINE_CHARS) + ` …(${line.length - MAX_LINE_CHARS} chars truncated)`
}

function truncate(text) {
  const lines = String(text ?? '').split('\n').map(truncateLine)
  if (lines.length <= MAX_LINES) return lines.join('\n')
  return lines.slice(0, MAX_LINES).join('\n') + `\n--- ${lines.length - MAX_LINES} lines truncated ---`
}

const fence = (text, lang = '') => fenced(truncate(text), lang)

// The session's own copies of the tags framing it would end the frame early
const escapeFrame = text => text.replace(/<(\/?)(summary|transcript)\b/gi, '&lt;$1$2')

function resultText(r) {
  const parts = Array.isArray(r?.content) ? r.content : [r?.content]
  return parts.map(p => typeof p === 'string' ? p : (p?.text ?? JSON.stringify(p))).join('\n')
}

// The view's `~ 12k` badge: the full size of what the truncated text stands for
function size(text, model) {
  const n = countTokens(text, model)
  return n > 0 ? ` (~${fmtCompact(n)} tokens)` : ''
}
const took = ms => ms >= 1000 ? ` · ${fmtDuration(ms)}` : ''

// A listing's entries by name and size, in place of its text cut off after the first few
function renderItems({ intro, items, outro }, model) {
  const list = items.map(i => `- ${i.name}${size(i.content, model)}`).join('\n')
  return [intro && fence(intro), list, outro && fence(outro)].filter(Boolean).join('\n')
}

function renderCommand(cmd) {
  if (!cmd.name && !cmd.stdout) return null // only the caveat Claude Code puts before a command's output
  const line = cmd.name ? `Command: \`${cmd.name}${cmd.args ? ` ${cmd.args}` : ''}\`` : 'Command output:'
  return cmd.stdout ? `${line}\n${fence(cmd.stdout)}` : line
}

// `model`: the conversation's, for token counts and for naming a side request's own model
function renderBlock(b, model) {
  if (b.type === 'text') {
    const cmd = parseCommand(b.text)
    return cmd ? renderCommand(cmd) : truncate(b.text || '')
  }
  if (b.type === 'thinking') return b.redacted ? `_Thinking (encrypted${b.redacted > 1 ? ` · ${b.redacted}` : ''})_` : `Thinking${took(b.duration)}:\n${fence(b.thinking)}`
  if (b.type === 'tool_use') {
    const tail = b.result ? `\n${b.result.is_error ? 'error' : 'result'}:\n${fence(resultText(b.result))}` : ''
    const title = toolSummary(b.name, b.input)
    return `[${title}${took(b.duration)}]\n${fence(JSON.stringify(b.input, null, 2), 'json')}${tail}`
  }
  if (b.type === 'tool_result') return `${b.is_error ? 'error' : 'result'}:\n${fence(resultText(b))}`
  if (b.type === 'skill') return `Skill${b.name ? `: ${b.name}` : ''}${size(b.text, model)}:\n${fence(b.text)}`
  if (b.type === 'system') return `_${b.level ? `${b.level}: ` : ''}${b.title}_${b.url ? ` (${b.url})` : ''}${b.body ? `\n${fence(b.body)}` : ''}`
  if (b.type === 'image') return '[image]'
  if (b.type === 'attachment') {
    if (b.unsent) return null // logged, but never reached the model
    const view = attachmentView(b.attachment, b.rendered)
    const title = `_Attachment: ${view.title}_${hasText(view) ? size(view.body, model) : ''}`
    if (view.body == null) return title
    return `${title}\n${view.items?.length ? renderItems(view, model) : fence(view.body)}`
  }
  if (b.type === 'instruction') {
    const it = b.it
    const own = it.model ?? model
    const path = it.name && it.name !== it.file_path ? `\n\`${it.file_path}\`` : ''
    const body = it.error ? fence(`error: ${it.error}`) : it.items?.length ? renderItems(it, own) : fence(it.content || '')
    return `_${instructionTitle(it, model)}_${size(it.content, own)}${path}\n${body}`
  }
  return fence(safeJson(b), 'json')
}

// `seen`: a reply's records share its message id and usage, so its context size is given once
function renderTurn(t, seen, model) {
  const blocks = t.blocks.map(b => renderBlock(b, model)).filter(Boolean)
  if (!blocks.length) return null
  if (t.role === 'instruction') return `**Proxy (${SIDE_NOTE}):**\n\n${blocks.join('\n\n')}`
  if (t.role === 'compact') {
    const b = t.blocks[0]
    return `**${compactTitle(b)}**${b.summary ? `\n\nCompact summary${size(b.summary, model)}:\n${fence(b.summary)}` : ''}`
  }
  const role = t.role === 'system' ? 'System' : t.role === 'user' ? (t.queued ? 'User (queued)' : 'User') : 'Assistant'
  const stats = []
  if (t.tokenTotal > 0 && t.tokenDelta != null) stats.push(`${t.tokenDelta >= 0 ? '+' : ''}${fmtCompact(t.tokenDelta)} / ${fmtCompact(t.tokenTotal)} tokens`)
  const id = t.msgId ?? t.uuid
  if (t.usage && !seen.has(id)) {
    seen.add(id)
    stats.push(`context ${fmtCompact(contextSize(t.usage))}`)
    if (t.usage.cache_creation_input_tokens) stats.push(`cache write ${fmtCompact(t.usage.cache_creation_input_tokens)}`)
  }
  const time = t.ts != null ? ` · ${format(t.ts, 'HH:mm:ss')}` : ''
  const cleared = isClearTurn(t) ? '\n\n**Context cleared**' : ''
  return `**${role}${time}${stats.length ? ` (${stats.join(' · ')})` : ''}:**\n\n${blocks.join('\n\n')}${cleared}`
}

function renderTranscript(turns, { forkedFrom, forkedAt, continuesFrom }) {
  const model = currentModel(turns)
  const seen = new Set()
  const rows = turns.map(t => renderTurn(t, seen, model))
  // Marked where the view draws its divider: above the first group the branch made itself
  const groups = groupTurns(turns)
  const branch = branchPoint(groups, forkedFrom, forkedAt, continuesFrom)
  if (branch) {
    const at = turns.indexOf(groups[branch.index]?.turns[0])
    rows.splice(at === -1 ? rows.length : at, 0, `**Branched from session ${branch.from}**: the turns above were copied from it`)
  }
  return rows.filter(Boolean).join('\n\n---\n\n')
}

export function markdownSession(meta, items, instructions = {}, requestLog = null) {
  const t = meta.tokens
  const stu = meta.serverToolUse
  const wallDuration = meta.lastActivityAt - meta.startedAt
  const ctxLimit = contextWindow(meta.models)
  const contextPct = Math.round((meta.lastContextTokens / ctxLimit) * 100)
  const advice = cacheAdvice(meta)
  const cacheHitPct = (meta.cacheHitRatio * 100).toFixed(0)
  const transcript = items ? renderTranscript(flatten(items, instructions), meta) : '_Loading…_'
  const conversation = `\n# Conversation\n\n${transcript}`

  const summary = `
# Session: ${meta.sessionId}

# Summary
- Estimated cost: ${fmtUSD(meta.cost)}
- Total tokens: ${fmtCompact(meta.totalTokens)}
- Working time: ${fmtDuration(meta.activeMs)}
- Context size: ${fmtCompact(meta.lastContextTokens)} / ${fmtCompact(ctxLimit)} (${contextPct}%)${advice ? `

## Potential savings
- ${CACHE_LABELS[advice.policy]}: (${advice.pct.toFixed(0)}%) −${fmtUSD(advice.saving)}` : ''}

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
` : ''}- Started: ${format(meta.startedAt, 'pp')} (${new Date(meta.startedAt).toISOString()})
- Last activity: ${format(meta.lastActivityAt, 'pp')} (${new Date(meta.lastActivityAt).toISOString()})
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
${meta.subdir ? `- Subfolder: ${meta.subdir}\n` : ''}${meta.worktreePath ? `- Worktree: ${meta.worktreePath}\n` : ''}- Log file: ${meta.filePath}
${requestLog ? `- Proxy log: ${requestLog}
` : ''}`

  const body = `
<summary>
${escapeFrame(summary)}
</summary>


<transcript>
${escapeFrame(conversation)}
</transcript>`.trim()

  return { body }
}
