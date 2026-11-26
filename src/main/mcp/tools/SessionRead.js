import { z } from 'zod'
import * as fromRenderer from '../sessions/fromRenderer.js'
import { figures, fill, fmtSpan, label, openSession, parentOf, sessionArg, shortId, shownTurns, turnWithin, Refusal, Tool } from './utils.js'
import TEMPLATE from './session_read.md?raw'

// The turn numbers `spec` asks for, as [from, to] within 1..total: a range may end past the session, never start there.
// `kept` are the turns of the kind asked for: "-3" counts among them, or it would be the session's last three, with none of that kind
function turnRange(spec, turns, kept) {
  const total = turns.length
  const m = spec.trim().match(/^(?:(\d+)-(\d*)|-([1-9]\d*)|(\d+)|(last))$/) // "-0" would be the whole session, not its last none
  const [, from, to, tail, one, last] = m ?? []
  if (!m || (to && +to < +from)) throw new Refusal(`\`turns\` is not a range: "${spec}". Use "37-60", "300-", "-20", "212" or "last".`)
  if (last) return [turns.findLastIndex(t => t.role === 'assistant' && t.blocks.some(fromRenderer.isReply)) + 1 || total, total]
  if (tail) return [kept.at(-tail) ?? kept[0] ?? total, total]
  const start = turnWithin(+(one ?? from), total)
  return [start, one ? start : to ? Math.min(+to, total) : total]
}

// Reads a session's conversation by turn number, as the app's Conversation tab has it: its turns, one kind of its filter (`kind`) and
// its "Expand all" (`detail`), each turn written as the markdown export writes it.
// `kind` is not named `filter`, as the listing's is: there it takes a text.
// Not paged: a long session outgrows a caller's context (90-190k tokens even with its blocks cut), and Claude Code saves a reply that
// long to a file, for the caller to search and read in parts with its own tools
export class SessionRead extends Tool {
  name = 'session_read'
  description = 'Reads a Claude Code session\'s conversation as markdown, its turns numbered: prompts, replies, thinking, tool calls with their inputs and results, and in System turns what the requests sent (system prompt, tools, memory files). A turn\'s header gives its time, the tokens it added to the session\'s total and that total ("+1.1k / 28.5M tokens": a reply adds its output, a prompt or a tool result the context the next request read), and a reply\'s context size. Nearly all of a long session is tool calls and thinking: for what it was about pass `kind: "user"`, its prompts alone. A reply too long for the context is saved to a file: search it there, or read the turns wanted, rather than read it through.'
  schema = {
    session: sessionArg,
    turns: z.string().default('1-').describe('"37-60", "300-" (to the end), "-20" (the last twenty, of the kind `kind` keeps), "212" (one turn) or "last" (the final reply on).'),
    kind: z.enum(fromRenderer.FILTERS.map(f => f.value)).optional().describe('Keeps one kind of turn, numbered as in the whole: "user" (prompts), "assistant" (replies, with their thinking and tool calls), "system" (what the requests sent, and compactions) or "other" (side requests, outside the context). Default all.'),
    detail: z.enum(['brief', 'full']).default('brief').describe('"brief": every block of a turn cut to its first lines. "full": whole blocks, as a search for what they hold needs them.'),
  }

  async run({ session, turns: spec, kind, detail }) {
    const { meta, turns: all } = await openSession(this.sessions, session)
    const { turns, texts } = shownTurns(all, { whole: detail === 'full' })
    if (!turns.length) throw new Refusal(`${shortId(meta)} has no conversation.`)
    const kinds = kind && new Map(fromRenderer.groupTurns(all).flatMap(g => g.turns.map(t => [t, fromRenderer.turnCategory(g, t)])))
    const kept  = turns.flatMap((t, i) => !kind || kinds.get(t) === kind ? i + 1 : [])
    const [from, to] = turnRange(spec, turns, kept)
    const { models, tokens, cost } = figures(meta)
    const view = {
      session: shortId(meta), label: label(meta),
      // whose, where, on what, how much and when: its turns tell the time of day alone
      about: [parentOf(meta) && `subagent of ${parentOf(meta)}`, fromRenderer.projectLabel(meta), models, `${tokens} tokens`, cost, fmtSpan(meta.startedAt, meta.lastActivityAt)].filter(Boolean).join(' · '),
      from, to, total: turns.length, kind, brief: detail === 'brief',
      turns: kept.filter(n => n >= from && n <= to).map(n => ({ n, text: texts[n - 1] })),
      end: to === turns.length,
    }
    return fill(TEMPLATE, view).replace(/\n\n---$/, '') // no rule under the last turn, with nothing below it
  }
}
