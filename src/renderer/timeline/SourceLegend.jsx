import { SOURCE_COLORS, SOURCE_LABELS, SOURCE_ORDER } from '../utils/colors.js'
import './SourceLegend.css'

const sourceRank = k => { const i = SOURCE_ORDER.indexOf(k); return i === -1 ? SOURCE_ORDER.length : i }

export default function SourceLegend({ sources, filter, onToggle }) {
  if (!sources.length) return null
  return (
    <div className="source-legend">
      {sources.toSorted((a, b) => sourceRank(a) - sourceRank(b)).map(k => {
        const active = filter === k
        const dim = filter && !active
        return (
          <button key={k} type="button" className={`legend-chip ${active ? 'filter-active' : ''} ${dim ? 'dim' : ''}`} onClick={() => onToggle(k)}>
            <span className="swatch" style={{ background: SOURCE_COLORS[k] || SOURCE_COLORS.other }} />
            {SOURCE_LABELS[k] || k}
          </button>
        )
      })}
    </div>
  )
}
