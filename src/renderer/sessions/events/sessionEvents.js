import { format, isSameDay } from 'date-fns'
import { branchPoint, groupTurns, rowIndex } from '../view/transcript.js'
import { interruptLabel, isClearTurn } from '../view/labels.js'

// The events a turn marks, as [kind, name] pairs. `last` carries the model and effort of the replies so far, a change in either
// being one
function turnEvents(t, last) {
  const found = []
  const note  = t.role === 'system' ? t.blocks[0] : null
  if (t.role === 'compact') found.push(['compact', 'Compaction'])
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
// { kind, name, time, at, row }: `at` the row to jump to (its first turn's uuid, or 'bottom' for the latest), `row` its index
export function sessionEvents(turns, { continuesFrom, forkedFrom, forkedAt }) {
  const groups = groupTurns(turns)
  if (!groups.length) return []
  // Told by the time, with the day where the turns span several
  const first  = turns.find(t => t.ts)?.ts
  const last   = turns.findLast(t => t.ts)?.ts
  const dated  = isSameDay(first, last) ? 'HH:mm' : 'MMM d HH:mm'
  const event  = (kind, name, ts, row, at = groups[row].turns[0].uuid) => ({ kind, name, time: ts ? format(ts, dated) : '', at, row })
  const rows   = new Map(groups.flatMap((g, i) => g.turns.map(t => [t, i])))
  const seen   = {}
  const branch = branchPoint(groups, forkedFrom, forkedAt, continuesFrom)
  // First in its row, as its divider is
  const marked = branch && branch.index < groups.length
    ? [event('branch', `Branched from ${branch.from.slice(0, 8)}`, groups[branch.index].turns.find(t => t.ts)?.ts, branch.index)] : []
  let ts = first // an untimestamped record (a permission mode change) is told by the one before it
  for (const t of turns) {
    ts = t.ts ?? ts
    for (const [kind, name] of turnEvents(t, seen)) {
      marked.push(event(kind, name, ts, rows.get(t)))
    }
  }
  return [
    event('start', continuesFrom == null ? 'Session start' : 'Period start', first, 0),
    ...marked.sort((a, b) => a.row - b.row), // stable, so a row's events keep their order
    event('latest', 'Latest', last, groups.length - 1, 'bottom'),
  ]
}

// Where the conversation row `at` (as Session holds it: null for the end) is among the events: the one it comes after, the last
// at or above it, and the ones either side of it to step to
export function eventsAt(turns, events, at) {
  const groups = groupTurns(turns)
  const row = at == null ? groups.length - 1 : rowIndex(groups, at)
  if (row < 0) return {}
  return { picked: events.findLast(e => e.row <= row), earlier: events.findLast(e => e.row < row), later: events.find(e => e.row > row) }
}
