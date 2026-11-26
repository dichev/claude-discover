// What the MCP tools share: the period or the session they take, and how they write a reply
import path from 'node:path'
import { endOfDay, format, isValid, parseISO } from 'date-fns'
import Mustache from 'mustache'
import { z } from 'zod'
import { SessionFile } from '../../sessions/SessionFile.js'
import { clip, flatten, modelsLabel, renderTurns, rowLabel, fmtCompact, fmtUSD } from '../sessions/fromRenderer.js'

// What every tool is: read-only, reading through `sessions`, the app's own reader, whose scans and reads answer beside
// what its window watches. A tool's .md writes its reply from the values `run` hands it
export class Tool {
  annotations = { readOnlyHint: true }

  constructor(sessions) {
    this.sessions = sessions
  }
}

// A tool's no (no such session, a bad range): its message is the answer, for the model to act on. Any other error is a bug
export class Refusal extends Error {}

const TIME_FORMS = '"30m", "24h", "7d" or "2w" back from now (minutes, hours, days, weeks), "2026-11-17" or an ISO time'

// The period's arguments, told the same way in each tool
export const periodArgs = {
  since: z.string().default('7d').describe(`Start of the period: ${TIME_FORMS}.`),
  until: z.string().optional().describe('End of the period, in the same forms: a date takes in that whole day. Default now.'),
}

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }

// "30m", "24h", "7d" or "2w" before now, a day ("2026-11-17": its start, or its end for `until`), or an ISO time.
// The units are lower case alone: "1M" asks for a month, and would get a minute
function timeOf(name, value, now) {
  const text = value.trim()
  const ago  = text.match(/^(\d+)\s*([mhdw])$/)
  if (ago) return now - ago[1] * UNIT_MS[ago[2]]
  const date = parseISO(text)
  // parseISO alone takes "14" for the year 1400
  if (!/^\d{4}-\d{2}-\d{2}/.test(text) || !isValid(date)) throw new Refusal(`\`${name}\` is not a time: "${text}". Use ${TIME_FORMS}.`)
  return name === 'until' && /^\d{4}-\d{2}-\d{2}$/.test(text) ? +endOfDay(date) : +date
}

// The { start, end } a tool's `since` and `until` span: up to now when it's open-ended
export function periodOf(since, until) {
  const now    = Date.now() // read once: "24h" up to now spans a day exactly
  const period = { start: timeOf('since', since, now), end: until ? timeOf('until', until, now) : now }
  if (period.start > period.end) throw new Refusal(until ? '`since` is after `until`.' : '`since` is in the future.')
  return period
}

// The session's argument, told the same way in each tool
export const sessionArg = z.string().describe('The session\'s id or the start of it, as list_sessions gives it; a subagent by its "agent-…" name or its agent id.')

const CANDIDATES = 10
const EVER       = { start: 0, end: Infinity }
const named      = file => file.replace(/\\/g, '/').replace(/\.jsonl$/, '')

// The transcripts `ref` names, as [{ file, name }]: by a session id or the start of it (`agent-…` for a subagent, or its id whole,
// as its session's transcript prints it), or by a `name`, the path below the projects folder that tells apart the transcripts
// sharing an id (one per project it ran in)
async function find({ scanner }, ref) {
  const want = named(ref.trim())
  if (!want) return []
  const files = []
  await scanner.scan(EVER, { onFile: file => { files.push({ file, name: named(path.relative(scanner.root, file)), id: new SessionFile(file).sessionId }) } })
  const exact = files.filter(f => f.name === want || f.id === want || f.id === `agent-${want}`)
  return exact.length ? exact : files.filter(f => f.id.startsWith(want))
}

// The file of the one transcript `ref` names, refused when none or several do
export async function sessionFile(sessions, ref) {
  const found = await find(sessions, ref)
  if (!found.length) throw new Refusal(`No session "${ref}": list_sessions gives their ids.`)
  if (found.length > 1) {
    const names = found.map(f => `- ${f.name}`).sort()
    const more  = names.length > CANDIDATES ? `\n…and ${names.length - CANDIDATES} more` : ''
    throw new Refusal(`"${ref}" names ${names.length} transcripts, pass one as \`session\`:\n${names.slice(0, CANDIDATES).join('\n')}${more}`)
  }
  return found[0].file
}

// That transcript read whole: its meta, its conversation's turns and what its requests sent
export async function openSession(sessions, ref) {
  const read = await sessions.readFile(await sessionFile(sessions, ref))
  return { ...read, turns: flatten(read.items, read.instructions) }
}

// The turns a reply numbers, from 1, each with its text: about a third have nothing to show (what was logged but never sent), and would
// leave holes in the numbers. Every turn is written first: what one tells depends on those before it
export function shownTurns(all, opts) {
  const texts = renderTurns(all, opts)
  return { turns: all.filter((_, i) => texts[i]), texts: texts.filter(Boolean) }
}

// The turn `n`, refused when the session has none by that number
export function turnWithin(n, total) {
  if (n < 1 || n > total) throw new Refusal(`No turn ${n}: the session's turns are 1-${total}.`)
  return n
}

// One form for every date a reply tells, with its year. A span names the time zone too: the dates are the machine's local ones
export const fmtDay  = ts => format(ts, 'yyyy-MM-dd')
export const fmtDate = ts => format(ts, 'yyyy-MM-dd HH:mm')
export const fmtSpan = (start, end) => `${fmtDate(start)} → ${fmtDate(end)} (${format(end, 'O')})`

// When a session began: in a period it was already going before, when it picked up there and the day it continued from
const started = s => fmtDate(s.startedAt) + (s.continuesFrom ? ` (continued from ${fmtDay(s.continuesFrom)})` : '')

// A session's figures as the list's row tells them, by the names the templates have them
export const figures = s => ({ models: modelsLabel(s), tokens: fmtCompact(s.totalTokens), cost: s.cost ? fmtUSD(s.cost) : '—', started: started(s), lastActive: fmtDate(s.lastActivityAt) })

// A session as a reply names it: a main one by the start of its id, a subagent by its whole name, and beside it the list's label for it
export const shortId = s => s.parentSessionId ? s.sessionId : s.sessionId.slice(0, 8)
export const label   = s => clip(rowLabel(s))
export const parentOf = s => s.parentSessionId?.slice(0, 8)

// A reply from its mustache template (a tool's .md): there `{{name}}` is a table's cell, `{{{name}}}` text as it is.
// A Windows checkout gives the template CRLF line ends, and a `|` in a cell would end it early
export const fill = (template, view) => Mustache.render(template.replace(/\r\n/g, '\n'), view, {}, { escape: cell => String(cell).replace(/\|/g, '\\|') }).trimEnd()
