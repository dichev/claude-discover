import { Suspense, use, useEffect, useMemo, useRef, useState } from 'react'
import { Hourglass, Gauge, MessageSquare, Clock, Zap, DollarSign, Brain, GitBranch, ChevronDown, ChevronRight } from 'lucide-react'
import { SOURCE_COLORS } from '../utils/colors.js'
import { fmtCompact, fmtNum, fmtUSD, fmtDuration, fmtAgo, tone } from '../utils/formatting.js'
import { THRESHOLDS as T } from '../utils/thresholds.js'
import { parseCommand } from './view/labels.js'
import { subagentClusters, isJournal } from '../utils/subagents.js'
import { useLocalStorage } from '../utils/useLocalStorage.js'
import './SessionList.css'

const TIPS = {
  cache1h: 'Billed 2× — prefer the default 5m cache',
  context: `Consider keeping it below ${fmtCompact(T.context.warn)} tokens`,
  messages: `Consider sessions below ${fmtCompact(T.messages.warn)} messages`,
  time: `Consider sessions under ${T.workTime.warn / 60_000}m`,
  effort: 'Thinks longer and spends more output tokens than high',
}

const EFFORT_BADGE = { xhigh: 'warn-badge', max: 'danger-badge' }

const sumOf = (sessions, key) => sessions.reduce((sum, s) => sum + (s[key] || 0), 0)

// Icon-only badge: its tip doubles as its accessible name
const Badge = ({ className, tip, icon: Icon }) => <span className={className} role="img" aria-label={tip} data-tooltip-content={tip}><Icon size={11} /></span>

// The row's time and tokens/cost columns; `toned` colors them against the per-session thresholds
const RowStats = ({ at, tokens, cost, sortBy, toned }) => <>
  <span className="session-row-time">{fmtAgo(at)}</span>
  <span className="session-row-stats">
    <span className={`${sortBy === 'tokens' ? 'stat-primary' : 'stat-secondary'} ${toned ? tone(tokens, T.tokens) : ''}`}>
      {fmtCompact(tokens)}
    </span>
    <span className={`${sortBy === 'cost' ? 'stat-primary' : 'stat-secondary'} ${toned ? tone(cost, T.cost) : ''}`}>
      {cost ? fmtUSD(cost) : '—'}
    </span>
  </span>
</>

// The project and model(s) that end a row's second line
const ProjectModels = ({ project, projectShort, subdir, models, efforts }) => <>
  {project && <span className="session-project">{projectShort}{subdir && ` › ${subdir}`}</span>}
  {models?.length > 0 && <span className="session-model">{models.map(m => m.replace(/^claude-/, '')).join(', ')}{efforts?.length > 0 && ` ${efforts.join(', ')}`}</span>}
</>

// Read once per avatar file, however many sessions share it
const avatars = new Map()
const Avatar = ({ session }) => {
  if (!avatars.has(session.avatar)) avatars.set(session.avatar, window.api.readAvatar(session.filePath))
  const src = use(avatars.get(session.avatar))
  return src && <span className="session-avatar"><img src={src} alt="" /></span>
}

export default function SessionList({ sessions, selectedId, deepLink, onSelect }) {
  const selectedRef             = useRef(null)
  const [sortBy, setSortBy]     = useLocalStorage('session-list.sort', 'time')
  const [filter, setFilter]     = useState('')
  const [expanded, setExpanded] = useState(() => new Map())
  const [, tick]                = useState(0)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // keep the relative "Xm ago" times fresh
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])


  // The first command, when nothing better names the session.
  const labelCommand = (s) => !(s.aiTitle || s.summary || s.firstUserPrompt) && parseCommand(s.firstUserCommand)
  const sessionLabel = (s) => {
    const c = labelCommand(s)
    return c ? `${c.name || c.message} ${c.args}` : (s.aiTitle || s.summary || s.firstUserPrompt || s.sessionId || '')
  }

  const q = filter.trim().toLowerCase()
  const filtered = q ? sessions.filter((s) => [
    s.customTitle, s.agentName, s.tag, s.aiTitle, s.summary, s.firstUserPrompt, s.firstUserCommand, s.project, s.subdir, s.worktree, s.tempPath, s.sessionId, s.model, s.gitBranch
  ].filter(Boolean).join(' ').toLowerCase().includes(q)) : sessions

  const sorted = sortBy === 'cost'   ? [...filtered].sort((a, b) => (b.cost || 0) - (a.cost || 0))
               : sortBy === 'tokens' ? [...filtered].sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0))
               : sortBy === 'name'   ? [...filtered].sort((a, b) => sessionLabel(a).toLowerCase().localeCompare(sessionLabel(b).toLowerCase()))
               : filtered

  const grouped = useMemo(() => {
    // Subagents list under a header per run they were spawned in, newest run first, each run in the list's order
    const runsOf = Map.groupBy(subagentClusters(sorted), run => run[0].parentFilePath)
    const rank   = new Map(sorted.map((s, i) => [s, i]))
    return sorted.flatMap(s => runsOf.has(s.parentFilePath) ? [] : [
      { session: s },
      ...(runsOf.get(s.filePath) ?? []).toReversed().flatMap(run => {
        const runKey = `${run[0].filePath}::run`
        return [{ run, runKey }, ...run.toSorted((a, b) => rank.get(a) - rank.get(b)).map(c => ({ session: c, runKey }))]
      }),
    ])
  }, [sorted])

  // Runs start collapsed, except the one holding the selected subagent; a click overrides either
  const selectedRun = grouped.find(i => i.runKey && i.session?.filePath === selectedId)?.runKey
  const isOpen      = key => expanded.get(key) ?? key === selectedRun
  const toggleRun   = key => setExpanded(prev => new Map(prev).set(key, !isOpen(key)))

  return (
    <div className="session-list">
      <div className="session-list-header">
        <div className="filter-wrap">
          <input
            className="filter"
            placeholder="Filter sessions…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
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
      <div className="session-list-scroll">
        {sorted.length === 0 && (
          <div className="empty">No sessions on this day.</div>
        )}
        {grouped.map(({ session: s, run, runKey }) => {
          const isCollapsed = !!runKey && !isOpen(runKey)
          if (run) {
            const Chevron = isCollapsed ? ChevronRight : ChevronDown
            const hidesSelected = isCollapsed && runKey === selectedRun
            return (
              <button
                type="button"
                key={runKey}
                ref={hidesSelected ? selectedRef : null}
                className={`session-row subagent-run ${hidesSelected ? 'selected' : ''}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggleRun(runKey)}
                style={{ borderLeftColor: SOURCE_COLORS[run[0].source] || SOURCE_COLORS.other }}
              >
                <span className="subagent-run-chevron"><Chevron size={14} aria-hidden="true" /></span>
                <span className="session-row-main">
                  <span className="session-label subagent-run-title">
                    Subagents ({run.length})
                  </span>
                  <span className="session-time-bottom">
                    <ProjectModels {...run[0]} models={[...new Set(run.flatMap(c => c.models ?? []))]} efforts={[...new Set(run.flatMap(c => c.efforts ?? []))]} />
                  </span>
                </span>
                <RowStats at={Math.max(...run.map(c => c.lastActivityAt))} tokens={sumOf(run, 'totalTokens')} cost={sumOf(run, 'cost')} sortBy={sortBy} />
              </button>
            )
          }
          if (isCollapsed) return null
          const journal = isJournal(s)
          const isFork = !!s.forkedFrom
          const linked = !!deepLink && s.filePath === selectedId // opened by a claude-discover:// link, see App.jsx
          const command = labelCommand(s)
          const commandName = command && (command.name || command.message)
          const commandArgs = command && command.args.trim()
          const topEffort = ['max', 'xhigh'].find(e => s.efforts?.includes(e))
          const sessionName = s.customTitle && s.agentName && s.customTitle !== s.agentName
            ? `${s.customTitle} [${s.agentName}]`
            : (s.customTitle || s.agentName || '')
          return (
            <div
              key={s.filePath}
              ref={selectedId === s.filePath ? selectedRef : null}
              className={`session-row ${selectedId === s.filePath ? 'selected' : ''} ${runKey ? 'is-subagent-child' : ''} ${linked ? 'deep-linked' : ''}`}
              onClick={() => onSelect(selectedId === s.filePath ? null : s.filePath)}
              style={{ borderLeftColor: SOURCE_COLORS[s.source] || SOURCE_COLORS.other }}
            >
              <div className="session-row-main">
                <div className="session-label">
                  <span className="session-label-text">
                    {command ? commandArgs || commandName : sessionLabel(s)}
                  </span>
                </div>
                <div className="session-time-bottom">
                  {journal && <span className="subagent-tag">[journal: {s.workflowAgents} subagent{s.workflowAgents === 1 ? '' : 's'}]</span>}
                  {s.worktree && <span className="worktree-tag" data-tooltip-content={`Worktree of ${s.projectShort}`}>[{s.worktree}]</span>}
                  {isFork && <span className="fork-tag" role="img" aria-label="Forked" data-tooltip-content={`Forked from session ${s.forkedFrom.sessionId}`}><GitBranch size={12} /></span>}
                  {sessionName && <span className="session-name">{sessionName}</span>}
                  {command && <span className="session-command">{commandName}</span>}
                  {s.tag && <span className="session-tag">#{s.tag}</span>}
                  <ProjectModels {...s} />
                  {linked && <span className="deeplink-note">opened from deep link</span>}
                </div>
              </div>
              <div className="session-row-badges">
                {s.avatar && <Suspense><Avatar session={s} /></Suspense>}
                {s.tokens?.cacheCreation1h > 0 && <Badge className="warn-badge" tip={`Used 1h extended cache (${fmtNum(s.tokens.cacheCreation1h)} tokens)\n${TIPS.cache1h}`} icon={Hourglass} />}
                {s.lastContextTokens > T.context.danger && <Badge className="danger-badge" tip={`Context size: ${fmtCompact(s.lastContextTokens)} tokens\n${TIPS.context}`} icon={Gauge} />}
                {s.lastContextTokens > T.context.warn && s.lastContextTokens <= T.context.danger && <Badge className="warn-badge" tip={`Context size: ${fmtCompact(s.lastContextTokens)} tokens\n${TIPS.context}`} icon={Gauge} />}
                {s.messageCount > T.messages.danger && <Badge className="danger-badge" tip={`${fmtNum(s.messageCount)} messages\n${TIPS.messages}`} icon={MessageSquare} />}
                {s.messageCount > T.messages.warn && s.messageCount <= T.messages.danger && <Badge className="warn-badge" tip={`${fmtNum(s.messageCount)} messages\n${TIPS.messages}`} icon={MessageSquare} />}
                {s.activeMs > T.workTime.danger && <Badge className="danger-badge" tip={`Working time: ${fmtDuration(s.activeMs)}\n${TIPS.time}`} icon={Clock} />}
                {s.activeMs > T.workTime.warn && s.activeMs <= T.workTime.danger && <Badge className="warn-badge" tip={`Working time: ${fmtDuration(s.activeMs)}\n${TIPS.time}`} icon={Clock} />}
                {topEffort && <Badge className={EFFORT_BADGE[topEffort]} tip={`Effort: ${topEffort}\n${TIPS.effort}`} icon={Brain} />}
                {s.speed === 'fast' && <Badge className={`fast-badge ${s.fastPricingUnknown ? 'fast-badge-unknown' : ''}`} tip={s.fastPricingUnknown ? 'Used fast mode — cost is INACCURATE: no fast-mode price multiplier known for this model' : 'Used fast mode (speed: fast)'} icon={Zap} />}
                {s.priceUnknown && <Badge className="danger-badge" tip={`No price entry for ${s.models?.join(', ') || 'this model'} — cost is missing or understated`} icon={DollarSign} />}
              </div>
              <RowStats at={s.lastActivityAt} tokens={s.totalTokens} cost={s.cost} sortBy={sortBy} toned />
            </div>
          )
        })}
      </div>
    </div>
  )
}

