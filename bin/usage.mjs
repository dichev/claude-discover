#!/usr/bin/env node
/*
  Print per-period token usage and cost from local Claude Code transcripts.

  Usage:
    node bin/usage.mjs [daily|weekly|monthly] [--since yyyy-MM-dd] [--until yyyy-MM-dd] [--timezone Area/City]
    (granularity defaults to monthly)

  To compare against ccusage use UTC timezone:
    node bin/usage.mjs monthly --timezone UTC
    npx ccusage monthly
*/

import { addDays, addWeeks, addMonths, parseISO, isValid, format } from 'date-fns'
import { tz } from '@date-fns/tz'
import { SessionsService, periodBounds } from '../src/main/services/SessionsService.js'

const USAGE = 'Usage: node bin/usage.mjs [daily|weekly|monthly] [--since yyyy-MM-dd] [--until yyyy-MM-dd] [--timezone Area/City]'
const die = msg => { console.error(msg); process.exit(1) }

const GRANULARITIES = {
  daily:   { granularity: 'day',   step: addDays,   labelFmt: 'yyyy-MM-dd' },
  weekly:  { granularity: 'week',  step: addWeeks,  labelFmt: 'yyyy-MM-dd' }, // week start (Monday, per SessionsService)
  monthly: { granularity: 'month', step: addMonths, labelFmt: 'yyyy-MM' },
}

// Report columns: header, how to read the metric off a session, how to format the sum.
const num = n => n.toLocaleString('en-US')
const METRICS = [
  { header: 'Input',        get: s => s.tokens.input,         fmt: num },
  { header: 'Output',       get: s => s.tokens.output,        fmt: num },
  { header: 'Cache Create', get: s => s.tokens.cacheCreation, fmt: num },
  { header: 'Cache Read',   get: s => s.tokens.cacheRead,     fmt: num },
  { header: 'Total Tokens', get: s => s.totalTokens,          fmt: num },
  { header: 'Cost (USD)',   get: s => s.cost,                 fmt: c => '$' + c.toFixed(2) },
]
const aggregate = sessions => METRICS.map(m => sessions.reduce((acc, s) => acc + m.get(s), 0)) // one summed number per metric

// Parse argv into a config: the chosen granularity, the date range, and a date-fns
// timezone context (inTz) with helpers bound to it.
function parseCli(argv) {
  const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }

  const first = argv[0]
  const opt = first && !first.startsWith('--') ? GRANULARITIES[first] : GRANULARITIES.monthly // granularity is optional
  if (!opt) die(USAGE)

  const timezone = arg('--timezone')
  if (timezone) {
    try { Intl.DateTimeFormat(undefined, { timeZone: timezone }) }
    catch { die(`Invalid timezone: ${timezone} (expected an IANA name like UTC or Area/City)`) }
  }
  const inTz = timezone ? { in: tz(timezone) } : {} // date-fns context; {} → local time

  const parseDate = (name, str) => {
    if (str == null) return null
    const d = parseISO(str, inTz)
    if (!isValid(d)) die(`Invalid date for ${name}: ${str} (expected yyyy-MM-dd)`)
    return d
  }
  const since = parseDate('--since', arg('--since'))
  const until = parseDate('--until', arg('--until')) ?? new Date()
  return { opt, timezone, inTz, since, until }
}

// Scan one period at a time across the range, returning a row { period, totals } per
// non-empty period. Tokens are clipped to [since, until] so edge periods aren't over-counted.
async function collectRows({ opt, inTz, since, until }) {
  const service = new SessionsService()
  const fmtDate = (d, f = 'yyyy-MM-dd') => format(d, f, inTz)
  const dayBounds = d => periodBounds(fmtDate(d), 'day', inTz.in)
  const untilMs = dayBounds(until).end
  const sinceMs = since ? dayBounds(since).start : 0

  // Start at the --since period, else the earliest session on disk.
  let cursor = since
  if (!cursor) {
    const all = await service.scan({ start: 0, end: untilMs })
    if (!all.length) return []
    cursor = new Date(Math.min(...all.map(s => s.startedAt)))
  }

  const rows = []
  for (let d = cursor; ; d = opt.step(d, 1, inTz)) {
    const pb = periodBounds(fmtDate(d), opt.granularity, inTz.in)
    if (pb.start > untilMs) break
    const sessions = await service.scan({ start: Math.max(pb.start, sinceMs), end: Math.min(pb.end, untilMs) })
    const totals = aggregate(sessions)
    if (totals.some(v => v)) rows.push({ period: fmtDate(pb.start, opt.labelFmt), totals })
  }
  return rows
}

// Print the table (a TOTAL row appended); returns its width so the caller can right-align a footer.
function render(rows) {
  const grand = METRICS.map((_, i) => rows.reduce((acc, r) => acc + r.totals[i], 0))
  const all = [...rows, { period: 'TOTAL', totals: grand }]
  const headers = ['Period', ...METRICS.map(m => m.header)]
  const cells = all.map(r => [r.period, ...r.totals.map((v, i) => METRICS[i].fmt(v))])
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map(row => row[i].length)))
  const line = vals => vals.map((s, i) => i === 0 ? s.padEnd(widths[i]) : s.padStart(widths[i])).join(' │ ')
  const sep = widths.map(w => '─'.repeat(w)).join('─┼─')

  console.log(line(headers))
  console.log(sep)
  for (let i = 0; i < rows.length; i++) console.log(line(cells[i]))
  console.log(sep)
  console.log(line(cells.at(-1)))
  return sep.length
}

const cfg = parseCli(process.argv.slice(2))
const rows = await collectRows(cfg)
if (!rows.length) { console.log('No usage found.'); process.exit(0) }

const width = render(rows)
const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone
console.log('\n' + `Timezone is ${cfg.timezone || `${localTz} (local)`}`.padStart(width))
process.exit(0)
