import { Fragment, useEffect, useState } from 'react'
import { FlaskConical, X } from 'lucide-react'
import { format } from 'date-fns'
import { periodTitle } from '../utils/period.js'
import { plural } from '../utils/formatting.js'
import { experimentColor, experimentLabel, experimentLanes } from './experiments.js'
import './ExperimentDetails.css'

const fmtAt = ts => format(ts, 'MMM d, HH:mm')
const listOf = values => [...new Set(values.filter(Boolean))].sort().join(', ') || '—'
const replyModels = sessions => [...new Set(sessions.flatMap(s => s.models ?? []).map(m => m.replace(/\[.*\]$/, '')))].sort() // claude-opus-5-5[1m] → claude-opus-5-5
const isModelMap = v => v && typeof v === 'object' && Object.values(v).every(m => typeof m === 'string' && m.startsWith('claude-'))

// Shown in place of the session: the experiment's sessions in the shown period, and the settings Claude Code cached with it
export default function ExperimentDetails({ id, sessions, anchor, granularity, onClose }) {
  const [cached, setCached] = useState(undefined) // undefined while reading, null once Claude Code no longer lists it

  useEffect(() => {
    let cancelled = false
    window.api.readExperiments().then(all => { if (!cancelled) setCached(all[id] ?? null) }, () => { if (!cancelled) setCached(null) })
    return () => { cancelled = true }
  }, [id])

  const own = sessions.filter(s => s.experiment === id)
  const spans = experimentLanes(own)[0]?.spans ?? []
  const name = own[0]?.experimentName ?? cached?.name ?? null // the same name; the sessions have it before the read

  return (
    <div className="experiment-details">
      <header className="experiment-details-header">
        <div className="experiment-details-header-row">
          <h2 style={{ color: experimentColor(id) }}><FlaskConical size={15} /> {experimentLabel(id, name)}</h2>
          <button type="button" className="experiment-details-close" onClick={onClose} aria-label="Close" data-tooltip-content="Back to the session"><X size={15} /></button>
        </div>
      </header>
      <div className="experiment-details-body">
        <div className="experiment-details-content">
          <blockquote className="experiment-intro">
            Anthropic runs A/B experiments in Claude Code: some users get different features or settings than others.
            Claude Code records which experiment a session was in, but not all it changes. Anthropic says it doesn&apos;t
            degrade its models to cope with demand. Below is what your own data shows about this one.
          </blockquote>

          <dl>
            <dt>Id</dt><dd className="mono selectable">{id}</dd>
            <dt>Selected period</dt><dd>{periodTitle(anchor, granularity)}</dd>
            <dt>Sessions</dt><dd>{own.length}</dd>
            {spans.length > 0 && <><dt>Active</dt><dd>{fmtAt(spans[0].start)} → {fmtAt(spans.at(-1).end)}</dd></>}
            <dt>Models</dt><dd className="mono">{listOf(own.flatMap(s => s.models ?? []))}</dd>
            <dt>CLI versions</dt><dd className="mono">{listOf(own.map(s => s.version))}</dd>
          </dl>

          <h4>Settings delivered with it</h4>
          {cached === undefined ? <p className="experiment-note">Reading…</p>
            : cached ? <Settings {...cached} sessions={own} />
            : <p className="experiment-note">Not cached anymore: Claude Code keeps only the experiments it&apos;s in now.</p>}
        </div>
      </div>
    </div>
  )
}

function Settings({ settings, cachedAt, sessions }) {
  const entries = Object.entries(settings)
  return <>
    <p className="experiment-note">As Claude Code last cached them, on {fmtAt(cachedAt)}.</p>
    {entries.length ? (
      <dl className="experiment-settings">
        {entries.map(([key, value]) => (
          <Fragment key={key}>
            <dt className="mono">{key}</dt>
            <dd>
              {typeof value === 'string' && value.length > 80 ? <pre className="selectable">{value}</pre>
                : <span className="mono">{typeof value === 'string' ? value : JSON.stringify(value)}</span>}
              {/* a model map reads as a model swap, so say which models the replies came from */}
              {isModelMap(value) && <ModelCheck map={value} sessions={sessions} />}
            </dd>
          </Fragment>
        ))}
      </dl>
    ) : <p className="experiment-note">None of its own.</p>}
  </>
}

// Checked against the replies: the transcript logs the model that answered each one
function ModelCheck({ map, sessions }) {
  return [...new Set(Object.values(map))].map(to => {
    const n = sessions.filter(s => replyModels([s]).includes(to)).length
    return (
      <p key={to} className="experiment-note">
        {n ? `${plural(n, 'session')} of it in the selected period got replies from ${to}.`
          : `None of its ${plural(sessions.length, 'session')} in the selected period got a reply from ${to}; the replies came from ${replyModels(sessions).join(', ')}.`}
        {' '}What Claude Code uses this setting for isn&apos;t documented.
      </p>
    )
  })
}
