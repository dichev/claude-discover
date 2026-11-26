import { Suspense, use, useEffect, useRef, useState } from 'react'
import { Gauge, Zap, DollarSign, Brain, GitBranch, ChevronDown, ChevronRight, Bug, FlaskConical, Lightbulb } from 'lucide-react'
import { fmtCompact, fmtUSD, fmtAgo, tone } from '../utils/formatting.js'
import { THRESHOLDS as T } from '../utils/thresholds.js'
import { filterSessions, sortSessions, groupRuns, runSummary, rowLabel, rowTags, projectLabel, modelsLabel, sessionBadges } from './sessionRows.js'
import { useLocalStorage } from '../utils/useLocalStorage.js'
import { activity, lastChange } from '../utils/activity.js'
import { useClock } from '../utils/useClock.js'
import './SessionList.css'

const BADGE_ICONS = { context: Gauge, effort: Brain, fast: Zap, price: DollarSign, advisor: Lightbulb, experiment: FlaskConical, debug: Bug }

// Icon (or short text) badge: its tip doubles as its accessible name
const Badge = ({ className, tip, icon: Icon, text }) => <span className={className} role="img" aria-label={tip} data-tooltip-content={tip}>{text ?? <Icon size={11} />}</span>

// Re-renders itself when its text changes, so the clock doesn't re-render the whole list
const Ago = ({ at }) => useClock(() => fmtAgo(at))

// The row's tokens/cost and time columns
const RowStats = ({ s, sortBy }) => <>
  <span className="session-row-stats">
    <span className={`${sortBy === 'tokens' ? 'stat-primary' : 'stat-secondary'} ${tone(s.totalTokens, T.tokens)}`}>
      {fmtCompact(s.totalTokens)}
    </span>
    <span className={`${sortBy === 'cost' ? 'stat-primary' : 'stat-secondary'} ${tone(s.cost, T.cost)}`}>
      {s.cost ? fmtUSD(s.cost) : '—'}
    </span>
  </span>
  <span className="session-row-time"><Ago at={s.lastActivityAt} /></span>
</>

// The project and model(s) that end a row's second line
const ProjectModels = ({ s }) => <>
  {s.project && <span className="session-project">{projectLabel(s)}</span>}
  {s.models?.length > 0 && <span className="session-model">{modelsLabel(s)}</span>}
</>

// Read once per avatar file, however many sessions share it
const avatars = new Map()
const Avatar = ({ session }) => {
  if (!avatars.has(session.avatar)) avatars.set(session.avatar, window.api.readAvatar(session.filePath))
  const src = use(avatars.get(session.avatar))
  return src && <span className="session-avatar"><img src={src} alt="" /></span>
}

// A span, so it can sit in a run's button too; there the per-session badges show its worst subagent
const Badges = ({ s, run }) => (
  <span className="session-row-badges">
    {s.avatar && <Suspense><Avatar session={s} /></Suspense>}
    {sessionBadges(s, run).map(b => <Badge key={b.key} className={b.className} tip={b.tip} text={b.text} icon={BADGE_ICONS[b.key]} />)}
  </span>
)

export default function SessionList({ sessions, selectedId, deepLink, onSelect }) {
  const selectedRef             = useRef(null)
  const [sortBy, setSortBy]     = useLocalStorage('session-list.sort', 'time')
  const [filter, setFilter]     = useState('')
  const [expanded, setExpanded] = useState(() => new Map())

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // Keep the live dots fresh: re-render only when some row's activity changes
  const now = useClock(() => lastChange(sessions.map(s => s.lastActivityAt)))

  const q        = filter.trim()
  const filtered = filterSessions(sessions, filter)
  const sorted   = sortSessions(filtered, sortBy)
  const grouped  = groupRuns(sorted)

  // Runs start collapsed, except the one holding the selected subagent; a click overrides either
  const selectedRun = grouped.find(i => i.runKey && i.session?.filePath === selectedId)?.runKey
  const isOpen      = key => expanded.get(key) ?? key === selectedRun
  const toggleRun   = key => setExpanded(prev => new Map(prev).set(key, !isOpen(key)))
  const rows        = grouped.filter(i => i.run || !i.runKey || isOpen(i.runKey))

  const moveSelection = e => {
    const step    = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    const visible = rows.flatMap(r => r.session ?? [])
    const current = visible.findIndex(s => s.filePath === selectedId)
    if (!step || current < 0) return
    e.preventDefault()
    const next = visible[current + step]
    if (next) onSelect(next.filePath)
  }

  return (
    <div className="session-list">
      <div className="session-list-header">
        <div className="filter-wrap">
          <input
            className={`filter${q ? ' filter-active' : ''}`}
            placeholder="Filter sessions…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          {filter && (
            <button type="button" className="filter-clear" aria-label="Clear filter" onClick={() => setFilter('')}>×</button>
          )}
        </div>
        <div className="session-list-header-row">
          {q && <span className="filter-count">Filtered {filtered.length}/{sessions.length}</span>}
          <div className="sort-toggle" role="group" aria-label="Sort sessions">
            <span className="sort-toggle-label">Sort by:</span>
            <button type="button" className={`sort-pill ${sortBy === 'time'   ? 'active' : ''}`} onClick={() => setSortBy('time')}>Time</button>
            <button type="button" className={`sort-pill ${sortBy === 'name'   ? 'active' : ''}`} onClick={() => setSortBy('name')}>Name</button>
            <button type="button" className={`sort-pill ${sortBy === 'cost'   ? 'active' : ''}`} onClick={() => setSortBy('cost')}>Cost</button>
            <button type="button" className={`sort-pill ${sortBy === 'tokens' ? 'active' : ''}`} onClick={() => setSortBy('tokens')}>Tokens</button>
          </div>
        </div>
      </div>
      <div className="session-list-scroll" tabIndex={0} onKeyDown={moveSelection}>
        {sorted.length === 0 && (
          <div className="empty">No sessions on this day.</div>
        )}
        {rows.map(({ session: s, run, runKey }, i) => {
          // The branch stroke runs on below a row while a run's row follows it: from the parent (its start) or within its runs
          const branch = rows[i + 1]?.runKey ? (runKey ? 'branch-below' : 'branch-start') : ''
          if (run) {
            const isCollapsed = !isOpen(runKey)
            const Chevron = isCollapsed ? ChevronRight : ChevronDown
            const hidesSelected = isCollapsed && runKey === selectedRun
            const summary = runSummary(run)
            return (
              <button
                type="button"
                key={runKey}
                ref={hidesSelected ? selectedRef : null}
                className={`session-row subagent-run ${branch} ${hidesSelected ? 'selected' : ''} ${activity(summary.lastActivityAt, now)}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggleRun(runKey)}
              >
                <span className="subagent-run-arrow" aria-hidden="true" />
                <span className="session-label subagent-run-title">
                  Subagents ({run.length})
                  <Chevron size={14} aria-hidden="true" />
                </span>
                <span className="session-time-bottom">
                  <ProjectModels s={{ ...run[0], ...summary }} />
                </span>
                <Badges s={summary} run />
                <RowStats s={summary} sortBy={sortBy} />
              </button>
            )
          }
          const linked = !!deepLink && s.filePath === selectedId // opened by a claude-discover:// link, see App.jsx
          return (
            <div
              key={s.filePath}
              ref={selectedId === s.filePath ? selectedRef : null}
              className={`session-row ${branch} ${selectedId === s.filePath ? 'selected' : ''} ${runKey ? 'is-subagent-child' : ''} ${linked ? 'deep-linked' : ''} ${activity(s.lastActivityAt, now)}`}
              onClick={() => onSelect(selectedId === s.filePath ? null : s.filePath)}
            >
              <div className="session-label">
                <span className="session-label-text">{rowLabel(s)}</span>
              </div>
              <div className="session-time-bottom">
                {rowTags(s).map(t => t.text
                  ? <span key={t.key} className={t.key} data-tooltip-content={t.tip}>{t.text}</span>
                  : <span key={t.key} className={t.key} role="img" aria-label="Forked" data-tooltip-content={t.tip}><GitBranch size={12} /></span>)}
                <ProjectModels s={s} />
                {linked && <span className="deeplink-note">opened from deep link</span>}
              </div>
              <Badges s={s} />
              <RowStats s={s} sortBy={sortBy} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
