// Anthropic's server-side experiments the sessions ran in: SessionParser's `experiment` id, named only while Claude Code's config still lists it

export const experimentLabel = (id, name) => name ? name.replace(/^claude_code_|_experiment$/g, '') : id.slice(0, 8)

export const experimentText = ({ experiment, experimentName }) => experimentName ? `${experimentName} (${experiment})` : experiment

export const experimentTip = (id, name, ...more) => [`Anthropic experiment${name ? `: ${name}` : ''}`, id, ...more].join('\n')

// A steady color per id, so a lane and its sessions' badges match across periods; hues 40–320 skip the reds, which read as errors
export function experimentColor(id) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${40 + h % 280} 65% 62%)`
}

// One lane per experiment, with its sessions' active spans merged, earliest first
export function experimentLanes(sessions) {
  const byId = new Map()
  for (const s of sessions) {
    if (!s.experiment) continue
    let lane = byId.get(s.experiment)
    if (!lane) byId.set(s.experiment, lane = { id: s.experiment, name: null, sessions: 0, spans: [] })
    lane.name ||= s.experimentName || null
    lane.sessions++
    lane.spans.push(...(s.activityPeriods?.length ? s.activityPeriods : [{ start: s.startedAt, end: s.lastActivityAt }]))
  }
  for (const lane of byId.values()) lane.spans = merge(lane.spans)
  return [...byId.values()].sort((a, b) => a.spans[0].start - b.spans[0].start)
}

function merge(spans) {
  const out = []
  for (const { start, end } of [...spans].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1)
    if (last && start <= last.end) last.end = Math.max(last.end, end)
    else out.push({ start, end })
  }
  return out
}
