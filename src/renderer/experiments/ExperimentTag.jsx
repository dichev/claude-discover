import { FlaskConical } from 'lucide-react'
import { experimentColor, experimentTip } from './experiments.js'
import './ExperimentTag.css'

// A session row's experiment; not a badge: those flag what the user can change, and the experiment is Anthropic's pick
export default function ExperimentTag({ session, onOpen }) {
  if (!session.experiment) return null
  return (
    <span className="experiment-tag" role="button" style={{ color: experimentColor(session.experiment) }}
      data-tooltip-content={experimentTip(session.experiment, session.experimentName, 'Click for its details')}
      onClick={e => { e.stopPropagation(); onOpen(session.experiment) }}>
      <FlaskConical size={11} />
    </span>
  )
}
