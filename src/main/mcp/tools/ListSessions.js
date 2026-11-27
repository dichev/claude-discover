import { z } from 'zod'
import * as fromRenderer from '../sessions/fromRenderer.js'
import { figures, fill, fmtSpan, label, parentOf, periodArgs, periodOf, shortId, Tool } from './utils.js'
import TEMPLATE from './list_sessions.md?raw'

// A listing's size cap: about 13k tokens of a table (ids and figures run 1.8 characters a token).
// Past 25k tokens Claude Code saves an MCP result to a file, leaving the session its path to read: what session_read leaves a long one to
const MAX_CHARS = 24_000

// A row's cells, by the names the template has them. Few rows have flags (the list's badges, by their tips) or tags, so they share a column
const flags = (s, run) => fromRenderer.sessionBadges(s, run).map(b => b.tip.split('\n')[0])
const notes = lists => Object.entries(lists).filter(([, list]) => list.length).map(([name, list]) => `${name}: ${list.join(' · ')}`).join('; ')

const BEFORE = 50 // characters of a prompt quoted around the text found in it
const AFTER  = 90

const oneLine = text => text.replace(/\s+/g, ' ').trim()

// Where a session's prompts have `asked`, quoted with what's around it: null when none does. Both as one line, so a line break in either isn't a miss
function quote(prompts, asked) {
  for (const prompt of prompts) {
    const line = oneLine(prompt)
    const at   = line.toLowerCase().indexOf(asked)
    const to   = at + asked.length + AFTER
    if (at >= 0) return `${at > BEFORE ? '…' : ''}${line.slice(Math.max(0, at - BEFORE), to).trim()}${to < line.length ? '…' : ''}`
  }
  return null
}

// Under its session (`parent`) a subagent is a `↳` row that doesn't repeat the project; listed alone, it names the session it ran for.
// `quotes` has each session's prompt where the text asked for is, when one was
function row(s, parent, quotes) {
  const id = shortId(s)
  return {
    session: parent ? `↳ ${id}` : s.parentSessionId ? `${id} (subagent of ${parentOf(s)})` : id,
    label: label(s),
    ...quotes && { quote: quotes.get(s) },
    project: parent && s.project === parent.project && s.subdir === parent.subdir ? '' : fromRenderer.projectLabel(s),
    ...figures(s),
    notes: notes({ Flags: flags(s), Tags: fromRenderer.rowTags(s).map(t => t.text ?? t.tip) }),
  }
}

// A run of subagents as one row, the list's own when collapsed: their totals, from the first of them on, flagged by the worst of them
function runRow(run) {
  const summary = { ...fromRenderer.runSummary(run), startedAt: Math.min(...run.map(s => s.startedAt)) }
  return { session: '↳', label: fromRenderer.plural(run.length, 'subagent'), ...figures(summary), notes: notes({ Flags: flags(summary, true) }) }
}

// The list's rows in blocks to page by: each session with the runs of its subagents under it
function blocksOf(listRows) {
  return [...Map.groupBy(listRows, r => r.top)].map(([session, rows]) => ({ session, runs: rows.filter(r => r.run).map(r => r.run) }))
}

const chars = rows => rows.reduce((sum, r) => sum + Object.values(r).join(' | ').length, 0)

// A block as the table's rows: a row per run, or with `each` one per subagent, unless those alone would outgrow a reply
function rowsOf({ session, runs }, each, quotes) {
  const agents = each ? runs.flat().map(agent => row(agent, session, quotes)) : []
  return [row(session, null, quotes), ...agents.length && chars(agents) <= MAX_CHARS ? agents : runs.map(runRow)]
}

// Lists a period's sessions as the app's session list shows them: its filter box and sorts, its rows as a table, a session's subagents under it.
// `prompt` is the tool's own: it finds a session by anything typed in it, where the filter box goes by what names it
export class ListSessions extends Tool {
  name = 'list_sessions'
  alwaysLoad = true // where a question about sessions starts, so it isn't left to a search (860 tokens a session)
  description = `Lists the Claude Code sessions active in a period as a table, with each one's tokens and cost, latest first. A row's label is the task a subagent was given, else Claude's title for the session, else the prompt or command it opened with. Subagents follow their session in ↳ rows, one per run of them unless \`subagents\` is "each". Tokens (cache reads among them) and cost count the period only, and a session's leave its subagents out. A session begun before the period is told when it picked up in it, and the day it continued from. Notes flag what stands out (a cheaper cache lifetime, a large context, the advisor consulted) and tag a session by its name, command or agent type.`
  schema = {
    ...periodArgs,
    filter: z.string().optional().describe('Keeps the sessions holding this text, in any case, in their label, first prompt, name, tag, project, worktree, git branch, model or id. A session\'s id keeps its subagents too. To find a session by text typed anywhere in it, use `prompt`.'),
    prompt: z.string().optional().describe('Keeps the sessions with this text, in any case, in a prompt typed in them in the period, and quotes it there in a column of its own. Finds a session by what was asked in it.'),
    session: z.string().optional().describe('Keeps one session, by its id or the start of it, and its subagents.'),
    sort: z.enum(['time', 'name', 'cost', 'tokens']).default('time').describe('"time": latest activity first. "name": by label. "cost" or "tokens": largest first, by a session\'s own, its subagents not counted.'),
    subagents: z.enum(['grouped', 'each']).default('grouped').describe('"grouped": one ↳ row per run of subagents, with their count and totals. "each": every subagent in a ↳ row of its own, by its id and task, unless a session has more than a reply holds.'),
    limit: z.number().int().min(1).max(100).default(50).describe('Most sessions to return, their subagents not counted. A reply that fills up sooner says so.'),
    offset: z.number().int().min(0).default(0).describe('Sessions to skip, to continue a listing that was cut short.'),
  }

  async run({ since, until, filter = '', prompt = '', session = '', sort, subagents, limit, offset }) {
    const period = periodOf(since, until)
    const text   = filter.trim()
    const asked  = oneLine(prompt)
    const id     = session.trim()
    // By the ids alone: the filter finds an id in a path too, as of the sessions run in a folder named by it
    const isOfIt = s => s.sessionId.startsWith(id) || s.parentSessionId?.startsWith(id)
    const listed = fromRenderer.filterSessions(await this.sessions.scan(period), text).filter(isOfIt)
    const quoted = asked && await Promise.all(listed.map(async s => [s, quote(await this.sessions.prompts(s, period), asked.toLowerCase())]))
    const quotes = quoted && new Map(quoted.filter(([, q]) => q))
    const found  = quotes ? listed.filter(s => quotes.has(s)) : listed
    const blocks = blocksOf(fromRenderer.groupRuns(fromRenderer.sortSessions(found, sort)))
    const rows   = []
    let size = 0
    let next = offset
    for (const block of blocks.slice(offset, offset + limit)) {
      const blockRows = rowsOf(block, subagents === 'each', quotes) // only the page's sessions are worked into rows
      size += chars(blockRows)
      if (rows.length && size > MAX_CHARS) break // it opens the next page instead, with the room for its subagents
      rows.push(...blockRows)
      next++
    }
    const view = {
      count: fromRenderer.plural(blocks.length, 'session'), empty: !blocks.length,
      period: fmtSpan(period.start, period.end), filter: text, prompt: asked, of: id, sort,
      showing: next - offset < blocks.length && rows.length > 0 && `${offset + 1}-${next}`,
      full: next < Math.min(offset + limit, blocks.length), // the page ended on the size cap, short of `limit`
      rows, more: Math.max(0, blocks.length - next), next,
    }
    return fill(TEMPLATE, view)
  }
}
