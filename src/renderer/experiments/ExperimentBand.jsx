import { FlaskConical } from 'lucide-react'
import { plural } from '../utils/formatting.js'
import { experimentLanes, experimentColor, experimentLabel, experimentTip } from './experiments.js'
import './ExperimentBand.css'

const LANE = 14
const BAR  = 6
const PAD  = 3 // above and below the lanes, so they don't crowd the chart's header

// A lane per Anthropic experiment the shown sessions ran in, marking when they were active; a click opens its details
export default function ExperimentBand({ sessions, viewStart, viewEnd, width, gutter, openId, onOpen }) {
  const lanes = experimentLanes(sessions)
  if (!lanes.length) return null
  const xFor = ts => gutter + ((ts - viewStart) / (viewEnd - viewStart)) * (width - gutter)
  const height = lanes.length * LANE + 2 * PAD

  return (
    <svg width={width} height={height} className="experiment-band">
      <rect x={0} y={0} width={gutter} height={height} className="gantt-gutter" />
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className="gantt-group-sep" />
      {lanes.map((lane, i) => {
        const y = PAD + i * LANE
        const color = experimentColor(lane.id)
        return (
          <g key={lane.id} className={`experiment-lane${lane.id === openId ? ' open' : ''}`} fill={color} color={color} onClick={() => onOpen(lane.id)}>
            <rect x={0} y={y} width={width} height={LANE} className="experiment-lane-hit" />
            <title>{experimentTip(lane.id, lane.name, plural(lane.sessions, 'session'), 'Click for its details')}</title>
            <FlaskConical x={8} y={y + 2} size={10} />
            <text x={22} y={y + LANE / 2} dominantBaseline="central" className="experiment-band-label">{experimentLabel(lane.id, lane.name)}</text>
            {lane.spans.map(({ start, end }) => {
              if (end < viewStart || start > viewEnd) return null
              const x = xFor(Math.max(start, viewStart))
              return <rect key={start} x={x} y={y + (LANE - BAR) / 2} width={Math.max(2, xFor(Math.min(end, viewEnd)) - x)} height={BAR} rx={1} />
            })}
          </g>
        )
      })}
    </svg>
  )
}
