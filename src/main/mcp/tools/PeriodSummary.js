import { addHours, format, startOfHour } from 'date-fns'
import { z } from 'zod'
import * as fromRenderer from '../sessions/fromRenderer.js'
import { fill, fmtDate, fmtDay, fmtSpan, periodArgs, periodOf, Refusal, Tool } from './utils.js'
import TEMPLATE from './period_summary.md?raw'

const DAY      = 86_400_000
const MAX_ROWS = 366 // a year of days
const LABEL    = { hour: fmtDate, day: fmtDay, week: fmtDay, month: ts => format(ts, 'yyyy-MM') } // a week by its Monday

const startOf = (ts, by) => by === 'hour' ? +startOfHour(ts) : fromRenderer.startOfPeriod(ts, by)
const next    = (ts, by) => by === 'hour' ? +addHours(ts, 1) : fromRenderer.addPeriod(ts, by, 1)
const spent   = (tokens, cost) => ({ tokens: fromRenderer.fmtCompact(tokens), cost: fromRenderer.fmtUSD(cost) })

// Where each hour, day, week or month the period touches starts
function startsOf({ start, end }, by) {
  const starts = []
  for (let ts = startOf(start, by); ts <= end; ts = next(ts, by)) {
    if (starts.push(ts) > MAX_ROWS) throw new Refusal(`The period has more than ${MAX_ROWS} ${by}s: pass a coarser \`by\`, or a shorter period.`)
  }
  return starts
}

// A period's figures as the app's Period Summary pane has them: its totals, savings, tokens by kind and projects, and its chart as a table,
// by the hour or the day as there, or by the week or month. A project's subfolders are left out: temp folders run to hundreds.
export class PeriodSummary extends Tool {
  name = 'period_summary'
  description = 'Gives what Claude Code used in a period: its cost, tokens and working time (the active stretches, idle gaps left out), potential savings (had cache writes been kept 1h or 5m instead, or the advisor, a second model, not been consulted), the tokens and their cost by kind (input, output, cache writes and reads), then the tokens and cost of each hour, day, week or month and of each project that has any, the projects costliest first. Subagents are counted in. For the sessions behind the figures, pass the same period to list_sessions.'
  schema = {
    ...periodArgs,
    project: z.string().optional().describe('Counts only the projects holding this text, in any case, in their name as the reply lists them, or in their path.'),
    by: z.enum(['hour', 'day', 'week', 'month']).optional().describe('What a row of the usage over time spans. A week starts on Monday, and the first and last rows count only what falls in the period. Default "hour" for a period within a day, else "day".'),
  }

  async run({ since, until, project = '', by }) {
    const period = periodOf(since, until)
    by ??= period.end - period.start <= DAY ? 'hour' : 'day'
    const starts   = startsOf(period, by) // too many are refused before the scan
    const named    = project.trim()
    const wanted   = fromRenderer.findable(named) // a path typed with either slash, as the list's filter finds it
    const sessions = (await this.sessions.scan(period)).filter(s => fromRenderer.findable(`${s.projectShort ?? ''} ${s.project || '(no project)'}`).includes(wanted))
    const totals   = fromRenderer.sumTotals(sessions)
    const times    = fromRenderer.bucketTotals(starts, sessions).filter(b => b.tokens)
    const projects = fromRenderer.groupByProject(sessions).filter(g => g.totalTokens).sort((a, b) => b.cost - a.cost)
    // A parent folder tells two same-named projects apart, not more: those still sharing a name go by their path
    const short    = g => g.projectShort ?? g.key
    const sharing  = Map.groupBy(projects, short)
    const saving   = (label, amount) => ({ label, pct: (amount / totals.cost * 100).toFixed(0), saving: fromRenderer.fmtUSD(amount) })
    return fill(TEMPLATE, {
      period: fmtSpan(period.start, period.end), project: named, empty: !sessions.length,
      ...spent(totals.totalTokens, totals.cost), workingTime: fromRenderer.fmtDuration(totals.activeMs),
      savings: [
        ...totals.cacheSavings.map(([policy, amount]) => saving(fromRenderer.CACHE_LABELS[policy], amount)),
        ...totals.advisor.cost > 0 ? [saving(`Advisor, ${fromRenderer.plural(totals.advisor.calls, 'call')}`, totals.advisor.cost)] : [],
      ],
      cacheHit: totals.cacheHitRatio != null && `${Math.round(totals.cacheHitRatio * 100)}%`,
      mix: fromRenderer.tokenMix(totals).map(m => ({ label: m.label, ...spent(m.tokens, m.cost) })),
      by, times: times.map(b => ({ start: LABEL[by](b.start), ...spent(b.tokens, b.cost) })),
      projects: projects.map(g => ({ name: sharing.get(short(g)).length > 1 ? g.key : short(g), ...spent(g.totalTokens, g.cost) })),
    })
  }
}
