import { format, isSameDay } from 'date-fns'
import { branchPoint, groupTurns, rowIndex } from '../view/transcript.js'
import { interruptLabel, isClearTurn } from '../view/labels.js'

// The events a turn marks, as [kind, name] pairs. `last` carries the model and effort of the replies so far, a change in either
// being one. A compaction marks two: its own row reads the context it cut, so the one it left is the next row's (a third item, the rows on)
function turnEvents(t, last) {
  const found = []
  const note  = t.role === 'system' ? t.blocks[0] : null
  if (t.role === 'compact') found.push(['compact', 'Before compaction'], ['compacted', 'Compaction', 1])
  if (t.rewind) found.push(['rewind', 'Rewind'])
  if (isClearTurn(t)) found.push(['clear', 'Context cleared'])
  if (t.blocks.some(b => b.type === 'text' && interruptLabel(b.text))) found.push(['interrupt', 'Interrupted'])
  if (note?.mode) found.push(['mode', `Mode: ${note.mode}`])
  if (note?.subtype === 'away_summary') found.push(['away', 'Back after a break'])
  if (t.role === 'assistant') {
    if (t.model && last.model && t.model !== last.model) found.push(['model', `Model: ${t.model.replace(/^claude-/, '')}`])
    if (t.effort && last.effort && t.effort !== last.effort) found.push(['effort', `Effort: ${t.effort}`])
    last.model  = t.model ?? last.model
    last.effort = t.effort ?? last.effort
  }
  return found
}

// The conversation's moments to jump to in row order, from its start to its latest row (see turnEvents, branchPoint), each as
// { kind, name, time, at, row }: `at` the row to jump to (its first turn's uuid, or 'bottom' for the latest), `row` its index.
// The ends of a period between others add a `note` naming the day on that side, left out of the timeline's labels.
// Each of the meta's `resumes` (a new process picking the session up again) marks its prompt's row; a run of them with no other
// event between is told once, at its first, its count in the note: an SDK app resumes the session for every prompt
export function sessionEvents(turns, { continuesFrom, continuesTo, forkedFrom, forkedAt, resumes = [] }) {
  const groups = groupTurns(turns)
  if (!groups.length) return []
  // Told by the time, with the day where the turns span several. A continued period leads with its first request's instructions,
  // stamped when that was sent, before the period
  const first  = turns.find(t => t.ts > (continuesFrom ?? 0))?.ts
  const last   = turns.findLast(t => t.ts)?.ts
  const dated  = isSameDay(first, last) ? 'HH:mm' : 'MMM d HH:mm'
  const event  = (kind, name, ts, row, at = groups[row].turns[0].uuid) => ({ kind, name, time: ts ? format(ts, dated) : '', at, row })
  const rows   = new Map(groups.flatMap((g, i) => g.turns.map(t => [t, i])))
  const seen   = {}
  const branch = branchPoint(groups, forkedFrom, forkedAt, continuesFrom)
  // First in its row, as its divider is
  const marked = branch && branch.index < groups.length
    ? [event('branch', `Branched from ${branch.from.slice(0, 8)}`, groups[branch.index].turns.find(t => t.ts)?.ts, branch.index)] : []
  // A continued period picked up by a new process before any reply was resumed at its start, not just left open
  const resumed = resumes.map(r => turns.findLast(t => t.ts <= r)).filter(Boolean)
  const replied = groups.findIndex(g => g.turns.some(t => t.role === 'assistant'))
  const atStart = continuesFrom != null && resumed.length > 0 && (replied < 0 || rows.get(resumed[0]) <= replied)
  for (const t of atStart ? resumed.slice(1) : resumed) {
    marked.push(event('resume', 'Resumed', t.ts, rows.get(t)))
  }
  let ts = first // an untimestamped record (a permission mode change) is told by the one before it
  for (const t of turns) {
    ts = t.ts ?? ts
    for (const [kind, name, after = 0] of turnEvents(t, seen)) {
      const row = rows.get(t) + after
      if (row < groups.length) marked.push(event(kind, name, ts, row)) // no row after the last: Latest is that context
    }
  }
  const start  = event('start', continuesFrom == null ? 'Session start' : atStart ? 'Resumed' : 'Continued', first, 0)
  if (continuesFrom != null) start.note = `${atStart ? 'continues ' : ''}from ${format(continuesFrom, 'MMM d')}`
  const latest = event('latest', 'Latest', last, groups.length - 1, 'bottom')
  if (continuesTo != null) latest.note = `continues on ${format(continuesTo, 'MMM d')}`
  const runs = []
  for (const e of marked.sort((a, b) => a.row - b.row)) { // stable sort, so a row's events keep their order
    if (e.kind === 'resume' && runs.at(-1)?.[0].kind === 'resume') {
      runs.at(-1).push(e)
    } else {
      runs.push([e])
    }
  }
  return [start, ...runs.map(([e, ...more]) => more.length ? { ...e, note: `${more.length + 1}×` } : e), latest]
}

// Where the conversation row `at` (as Session holds it: null for the end) is among the events: the one it comes after, the last
// at or above it, and the ones either side of it to step to
export function eventsAt(turns, events, at) {
  const groups = groupTurns(turns)
  const row = at == null ? groups.length - 1 : rowIndex(groups, at)
  if (row < 0) return {}
  return { picked: events.findLast(e => e.row <= row), earlier: events.findLast(e => e.row < row), later: events.find(e => e.row > row) }
}
