#!/usr/bin/env node
//
// Claude Code status line. Reads the hook JSON from stdin and prints one colored line
// summarizing the model, context-window usage, token totals, and rate-limit windows.
// Installed as the `statusLine` command from the app: StatusBar → Status line → Activate
// (see src/main/services/StatuslineController.js).
//
// Example output:
//   [Opus 4.8] Context: ▓▓▓░░░░░░░ 32% used (45.2k, 87% cached)  |  Tokens: 1.2M total (+45.2k, 3 turns)  |  Usage limit: 42% used (resets in 2h 30m)  |  Weekly limit: 18% used (resets in 3d 4h)
//

import { readFileSync } from 'node:fs'
import { styleText } from 'node:util'


// Formatting
const THRESHOLDS = { // (white, yellow, red)
  context: [0, 100_000, 160_000],
  limit:   [0, 60, 90],
  cache:   [90, 60, 0],
  tokens:  [0, 250_000, 1_000_000],
  session: [0, 5_000_000, 20_000_000],
  turns:   [0, 10, 25],
}

const NO_COLOR = process.env.NO_COLOR !== undefined // standard opt-out; styleText can't honor it for piped output, so gate here

function colorize(kind, text, value = 0) {
  const bounds = THRESHOLDS[kind]
  const n = bounds.filter(b => value >= b).length
  const TIERS  = [null, 'yellow', 'red'] // indexed by severity tier
  const idx = bounds[0] < bounds.at(-1) ? n - 1 : bounds.length - n
  const color = TIERS[idx]
  // validateStream:false forces codes through the pipe (statusline output isn't a TTY)
  return color && !NO_COLOR ? styleText(color, text, { validateStream: false }) : text
}


// Collect stdin data
const data = JSON.parse(readFileSync(0, 'utf-8')) // fd 0 = stdin
const modelName = data.model.display_name.replace('Claude ', '')
const parts = []



// Context window
const ctx = data.context_window || {}
const total = ctx.context_window_size || 0
if (total) {
  const usage = ctx.current_usage || {}
  const hit  = usage.cache_read_input_tokens || 0
  const used = hit + (usage.cache_creation_input_tokens || 0) + (usage.input_tokens || 0)
  const pct  = Math.round((used / total) * 100)
  const cpct = used ? Math.floor((hit * 100) / used) : 0
  const filled = Math.floor(pct / 10)
  const bar    = '▓'.repeat(filled) + '░'.repeat(10 - filled)
  const head   = colorize('context', `${bar} ${pct}% used`, used)
  const tokens = colorize('context', `${(used / 1000).toFixed(1)}k`, used)
  const cached = used ? colorize('cache', `${cpct}% cached`, cpct) : `${cpct}% cached`
  parts.push(`Context: ${head} (${tokens}, ${cached})`)
}



// Total tokens (per session and per reply loop)
function agentLoopUsage(transcriptPath) { // Read the transcript JSONL and sum API usage for the current agent loop and the whole session.
  const lines   = readFileSync(transcriptPath, 'utf-8').split(/\r?\n/).filter(Boolean)
  let loop      = { total: 0, turns: 0 } // last prompt-reply breakdown
  const session = { total: 0, turns: 0 } // whole-session breakdown
  let seen = new Set() // One API response spans multiple lines (one per content block), each repeating the usage block, so dedupe by message.id.

  for (const line of lines) {
    const e = JSON.parse(line)
    const msg = e.message || {}

    if (e.type === 'user' && !e.isMeta) {
      const isToolReply = Array.isArray(msg.content) && msg.content.some(b => b.type === 'tool_result')
      if (!isToolReply) { // real user prompt = new loop
        loop = { total: 0, turns: 0 }
        seen = new Set()
      }
    } else if (e.type === 'assistant' && !seen.has(msg.id)) {
      seen.add(msg.id)
      const u = msg.usage || {}
      const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
      for (const d of [loop, session]) {
        d.total += tokens
        d.turns += 1
      }
    }
  }
  return [loop, session]
}

if (data.transcript_path) {
  const [loop, session] = agentLoopUsage(data.transcript_path)
  const fmt = n => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${(n / 1000).toFixed(1)}k`
  const tokensS = colorize('tokens',  fmt(loop.total),    loop.total)
  const sessS   = colorize('session', fmt(session.total), session.total)
  const turnsS  = colorize('turns', `${loop.turns} turn${loop.turns !== 1 ? 's' : ''}`, loop.turns)
  parts.push(`Tokens: ${sessS} total (+${tokensS}, ${turnsS})`)
}



// Rate limits (5-hour and weekly windows)
function fmtReset(resetsAt) { // Format remaining time until a unix-epoch reset, e.g. "2h 30m" (null if no timestamp).
  if (!resetsAt) return null
  const secs = Math.max(0, Math.floor(Number(resetsAt)) - Math.floor(Date.now() / 1000))
  const min  = Math.floor(secs / 60) % 60
  const hrs  = Math.floor(secs / 3600) % 24
  const days = Math.floor(secs / 86400)
  if (days) return `${days}d ${hrs}h`
  if (hrs)  return `${hrs}h ${min}m`
  return `${min}m`
}

const rl = data.rate_limits || {}
for (const [label, window] of [['Usage limit', rl.five_hour], ['Weekly limit', rl.seven_day]]) {
  if (!window) continue
  const pct      = Math.floor(window.used_percentage || 0)
  const reset    = fmtReset(window.resets_at)
  const resetStr = reset ? ` (resets in ${reset})` : ''
  parts.push(`${label}: ${colorize('limit', `${pct}% used${resetStr}`, pct)}`)
}


// Status line
process.stdout.write(`[${modelName}] ` + parts.join('  |  ') + '\n')
