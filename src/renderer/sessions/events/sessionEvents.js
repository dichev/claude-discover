import { format, isSameDay } from 'date-fns'
import { branchPoint, groupTurns, rowIndex } from '../view/transcript.js'
import { interruptLabel, isClearTurn } from '../view/labels.js'

const AGENT_TOOLS = new Set(['Agent', 'Task']) // older CLIs named the subagent tool Task
// Launches told once per row, by the plural when they're named differently
const PER_ROW = { agent: 'Subagents', workflow: 'Workflows' }

// A saved workflow's name, or the one its script's leading `meta` gives
const workflowName = input => input?.name ?? input?.script?.match(/\bname:\s*['"`]([^'"`]+)/)?.[1]

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
  for (const b of t.blocks) {
    if (b.type !== 'tool_use') continue
    if (AGENT_TOOLS.has(b.name)) found.push(['agent', `Subagent: ${b.input?.subagent_type ?? 'general-purpose'}`])
    if (b.name === 'Workflow') found.push(['workflow', workflowName(b.input) ? `Workflow: ${workflowName(b.input)}` : 'Workflow'])
  }
  return found
}

// The conversation's moments to jump to in row order, from its start to its latest row (see turnEvents, branchPoint), each as
// { kind, name, time, at, row }: `at` the row to jump to (its first turn's uuid, or 'bottom' for the latest), `row` its index.
// The ends of a period between others add a `note` naming the day on that side, left out of the timeline's labels.
// Each of the meta's `resumes` (a new process picking the session up again) marks its prompt's row; a run of them with no other
// event between is told once, at its first, its count in the note: an SDK app resumes the session for every prompt.
// Subagents and workflows launched in one row are told once too, by their name if they share one
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
    const prev = runs.at(-1)?.[0]
    if (e.kind === prev?.kind && (e.kind === 'resume' || e.kind in PER_ROW && e.row === prev.row)) {
      runs.at(-1).push(e)
    } else {
      runs.push([e])
    }
  }
  const told = ([e, ...more]) => !more.length ? e
    : { ...e, name: more.some(m => m.name !== e.name) ? PER_ROW[e.kind] : e.name, note: `${more.length + 1}×` }
  return [start, ...runs.map(told), latest]
}

// Where the conversation row `at` (as Session holds it: null for the end) is among the events: the one it comes after, the last
// at or above it, and the ones either side of it to step to
export function eventsAt(turns, events, at) {
  const groups = groupTurns(turns)
  const row = at == null ? groups.length - 1 : rowIndex(groups, at)
  if (row < 0) return {}
  return { picked: events.findLast(e => e.row <= row), earlier: events.findLast(e => e.row < row), later: events.find(e => e.row > row) }
}
