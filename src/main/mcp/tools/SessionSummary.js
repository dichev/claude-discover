import { z } from 'zod'
import * as fromRenderer from '../sessions/fromRenderer.js'
import { fill, fmtDay, fmtSpan, label, openSession, parentOf, sessionArg, shortId, shownTurns, turnWithin, Tool } from './utils.js'
import TEMPLATE from './session_summary.md?raw'

// A session's figures as the app's Summary pane has them, of its whole transcript and written as the markdown export writes them.
// Each event names the turn the pane jumps to for it (its row's first that shows), by session_read's numbers, and `turn` is the pane
// scrolled there: the figures are a row's, so a turn inside one gives them as of its end, and the reply says which turns it counted as one.
export class SessionSummary extends Tool {
  name = 'session_summary'
  description = 'Gives a Claude Code session\'s figures, its subagents not counted (a line tells what they cost, and the total with them): cost, tokens by kind and working time (its active stretches, where wall duration runs from start to end), its events (compactions, rewinds, interruptions, model, effort and mode changes, subagents launched, up to "Latest", its end) each with the turn to read it from, its context size and what fills it ("API overhead & unsplit" being what can\'t be told apart), potential savings (had its cache writes been kept 1h or 5m instead, or the advisor, a second model, not been consulted), its activity, and its model, git branch, project and transcript file. Pass an event\'s turn as `turn` for the figures as they were then, or to session_read to read on from there.'
  schema = {
    session: sessionArg,
    turn: z.number().int().min(1).optional().describe('Gives the cost, tokens, working time and context as they were at this turn, such as an event\'s: before a compaction, when a subagent was launched. A reply\'s thinking and tool calls are counted with it, at its end: the answer says which turn that is. Default the session\'s end.'),
  }

  async run({ session, turn }) {
    const { meta, turns: all, instructions, requestLog, debugLog } = await openSession(this.sessions, session)
    const { turns } = shownTurns(all)
    const rows      = fromRenderer.groupTurns(all)
    const shown     = new Set(turns)
    // A turn with nothing to show is told by the next that has
    const number    = t => Math.min(all.slice(0, all.indexOf(t)).filter(s => shown.has(s)).length + 1, turns.length)
    // Latest is the session's end: its row's first turn would read as where the session stopped
    const eventRef  = e => ` · #${e.kind === 'latest' ? turns.length : number(rows[e.row].turns[0])}`
    const row       = turn && rows.find(g => g.turns.includes(turns[turnWithin(turn, turns.length) - 1]))
    const end       = row && number(row.turns.findLast(t => shown.has(t)))
    // The events count the subagents launched: what they cost is a listing's to tell, of the session's time on, as who they were
    const launched  = fromRenderer.sessionEvents(all, meta).some(e => e.kind === 'agent' || e.kind === 'workflow')
    const agents    = launched ? (await this.sessions.scan({ start: meta.startedAt, end: Date.now() })).filter(s => s.parentFilePath === meta.filePath) : []
    const theirCost = agents.reduce((sum, s) => sum + (s.cost || 0), 0)
    return fill(TEMPLATE, {
      session: shortId(meta), label: label(meta), parent: parentOf(meta), active: fmtSpan(meta.startedAt, meta.lastActivityAt),
      subagents: agents.length > 0 && {
        count: agents.length, cost: fromRenderer.fmtUSD(theirCost), total: fromRenderer.fmtUSD(meta.cost + theirCost), since: fmtDay(meta.startedAt),
      },
      turns: turns.length, asOf: end,
      run: end > turn && { turn, start: number(row.turns[0]) },
      summary: fromRenderer.sessionSummary(meta, all, instructions, { requestLog, debugLog, at: row?.turns[0].uuid, eventRef }),
    })
  }
}
