import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import { format } from 'date-fns'
import { fmtDuration, fmtBytes, fmtNum, fmtUSD, fmtCompact } from '../../utils/formatting.js'
import { THRESHOLDS as T } from '../../utils/thresholds.js'
import { flatten } from './ConversationView.jsx'
import Toggle from '../../ui/Toggle.jsx'
import EditableMarkdown from '../../ui/EditableMarkdown.jsx'
import './AgentView.css'

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
  return fence(JSON.stringify(b, null, 2), 'json')
}

function renderTurn(t, total) {
  const role = t.role === 'user' ? 'User' : `Assistant${t.model ? ` (${t.model})` : ''}`
  const tokens = total > 0 && t.tokenDelta != null
    ? ` · ${t.tokenDelta >= 0 ? '+' : ''}${fmtCompact(t.tokenDelta)} / ${fmtCompact(total)}`
    : ''
  return `${role}${tokens}\n\n${t.blocks.map(renderBlock).join('\n\n')}`
}

function buildMarkdown(meta, items, truncated) {
  MAX_LINES = truncated ? 10 : Infinity
  MAX_LINE_CHARS = truncated ? 200 : Infinity
  const t = meta.tokens
  const stu = meta.serverToolUse
  const wallDuration = meta.lastActivityAt - meta.startedAt
  const contextPct = Math.round((meta.lastContextTokens / CONTEXT_WINDOW) * 100)
  const cacheHitPct = (meta.cacheHitRatio * 100).toFixed(0)
  let cumulative = 0
  const transcript = items
    ? flatten(items).map(t => {
        if (t.tokenDelta != null) cumulative += t.tokenDelta
        return renderTurn(t, cumulative)
      }).join('\n\n---\n\n')
    : '_Loading…_'
  const conversation = `# Conversation\n${transcript}`

  const note = truncated ? `Note: this is a transcript of a Claude Code session. To keep it compact, long content has been truncated (lines >${MAX_LINE_CHARS} chars, blocks >${MAX_LINES} lines). Treat the original session as if those parts were present in full; do not assume the assistant or user actually saw only the truncated form.` : ''
  const prompt = `
You are analyzing a Claude Code session to find token-reduction opportunities.

**Task**: Identify the top 3 concrete changes that would reduce token usage/cost for the same end result, specific to the session shown below (not generic advice).

**Input**:
  - \`<summary>\`: Primary diagnostic signals (token/cost/cache stats) 
  - \`<transcript>\`: Conversation with user messages, assistant turns, and tool calls.
  - ${note}

**Output**:
- Ranked list (1–3), highest impact first. No preamble.
- Each item formatted as:
**N. [Change title]** — [est. token/cost savings]: \n [1–2 sentence explanation with simple clear language for not too technical human readers]
- At the bottom list a table with the cost/tokes per section of work
`

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
- Git branch: ${meta.gitBranch || '—'}
- Source: ${meta.source || meta.entrypoint || '—'}
- Scheduled: ${meta.hasScheduledTask ? 'yes' : 'no'}
- CLI version: ${meta.version || '—'}
- cwd: ${meta.cwd || '—'}
- Log file: ${meta.filePath}
- File size: ${fmtBytes(meta.fileSize)}


`

  const body = `<summary>
${summary}
</summary>
<transcript>
${conversation}
</transcript>`.trim()

  return { prompt: prompt.trim(), body }
}

export default function AgentView({ meta, items }) {
  const [pretty, setPretty] = useState(false)
  const [fullText, setFullText] = useState(false)
  const truncated = !fullText
  const [copied, setCopied] = useState(false)
  const { prompt, body } = buildMarkdown(meta, items, truncated)
  const [currentPrompt, setCurrentPrompt] = useState(prompt)
  const onCopy = async () => {
    await navigator.clipboard.writeText(`${currentPrompt}\n\n---\n${body}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="agent-view">
      <div className="agent-view-actions">
        <Toggle checked={fullText} onChange={setFullText} label="full text" />
        <Toggle checked={pretty} onChange={setPretty} label="human-friendly" />
        <button type="button" className="agent-view-copy" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="agent-view-block">
        {pretty
          ? <div className="markdown"><ReactMarkdown rehypePlugins={[rehypeHighlight]}>{body}</ReactMarkdown></div>
          : <pre className="agent-view-raw">{body}</pre>}
      </div>
      <div className="agent-view-block">
        <EditableMarkdown source={prompt} styled={pretty} onChange={setCurrentPrompt} storageKey="agent-view-prompt" />
      </div>
    </div>
  )
}
