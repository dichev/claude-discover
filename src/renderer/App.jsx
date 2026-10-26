import { useEffect, useMemo, useState, useCallback } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import GanttChart from './timeline/GanttChart.jsx'
import Toolbar from './timeline/Toolbar.jsx'
import PeriodSummary from './timeline/PeriodSummary.jsx'
import SessionList from './sessions/SessionList.jsx'
import Session from './sessions/Session.jsx'
import StatusBar from './ui/StatusBar.jsx'
import { PaneErrorBoundary } from './ui/Errors.jsx'
import { closeFind } from './ui/useFindActive.js'
import { format, parse } from 'date-fns'
import { startOfPeriod, endOfPeriod, addPeriod } from './utils/period.js'
import { useLocalStorage } from './utils/useLocalStorage.js'
import { useScanProgress, resetScanProgress } from './utils/useScanProgress.js'
import './App.css'

export default function App() {
  const [sessions, setSessions]                 = useState([])
  const [loading, setLoading]                   = useState(true)
  const [listError, setListError]               = useState(null)
  const scanDone                                = useScanProgress(p => p?.scanning === false)
  const [granularity, setGranularity]           = useLocalStorage('gantt.granularity', 'day')
  const [anchor, setAnchor]                     = useState(() => startOfPeriod(Date.now(), granularity))
  const [selectedId, setSelectedId]             = useState(null)
  const [deepLink, setDeepLink]                 = useState(null) // the link the current selection came from, if any
  const [sourceFilter, setSourceFilter]         = useState(null)
  const [projectFilter, setProjectFilter]       = useLocalStorage('app.projects', [])
  const [expandedProjects, setExpandedProjects] = useLocalStorage('gantt-chart.expanded', [])
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'app.body', panelIds: ['list', 'detail'], storage: localStorage })
  const { defaultLayout: rootLayout, onLayoutChanged: onRootLayoutChanged } = useDefaultLayout({ id: 'app.root', panelIds: ['gantt', 'body'], storage: localStorage })

  const dayRange = useMemo(() => {
    const start = anchor
    const end = endOfPeriod(anchor, granularity)
    return { start, end }
  }, [anchor, granularity])

  // Left open across midnight, a view of the current period must follow the clock into the new one
  useEffect(() => {
    const shown = startOfPeriod(Date.now(), granularity)
    if (anchor !== shown) return // a past period was picked on purpose — never yank it forward
    const id = setInterval(() => {
      const current = startOfPeriod(Date.now(), granularity)
      if (current !== shown) setAnchor(current)
    }, 60_000)
    return () => clearInterval(id)
  }, [anchor, granularity])

  useEffect(() => {
    const date = format(anchor, 'yyyy-MM-dd')
    let cancelled = false
    resetScanProgress() // fresh scan for this period
    const timer = setTimeout(() => {
      window.api.listSessions(date, granularity)
        .then((s) => {
          if (!cancelled) { setSessions(s || []); setListError(null); setLoading(false) }
        }, (err) => { // clear the list too — the previous period's sessions would pass for this one's
          if (!cancelled) { setSessions([]); setListError(err); setLoading(false) }
        })
    }, loading ? 0 : 120) // the 120ms debounce is for arrowing through periods — don't make the first scan wait for it
    const off = window.api.onSessionsUpdate((u) => { // a previous period's update can land after the switch
      if (!cancelled && u.date === date && u.granularity === granularity) setSessions(u.sessions)
    })
    return () => { cancelled = true
     clearTimeout(timer)
     off()
     }
  }, [anchor, granularity])

  const dayItems = useMemo(() => {
    const sourceFiltered = sourceFilter ? sessions.filter(s => (s.source || 'other') === sourceFilter) : sessions
    const past = projectFilter.length ? sourceFiltered.filter(s => projectFilter.includes(s.project || '(no project)')) : sourceFiltered
    const availableSources = [...new Set(sessions.map(s => s.source || 'other'))]
    const byProject = new Map()
    for (const s of sourceFiltered) {
      const key = s.project || '(no project)'
      if (!byProject.has(key)) byProject.set(key, { key, projectShort: s.projectShort, temp: !!s.tempPath })
    }
    return { past, availableSources, projects: [...byProject.values()] }
  }, [sessions, sourceFilter, projectFilter])

  // `selectedId` is a file path, or a session id when the selection came from a deep
  // link — one id can cover several transcripts, one per cwd.
  const selected = useMemo(
    () => sessions.find((s) => s.filePath === selectedId || s.sessionId === selectedId) || null,
    [sessions, selectedId]
  )

  // Say why the detail pane is empty instead of just showing nothing
  let missing = null
  if (listError) missing = { text: "Couldn't load sessions", error: listError }
  else if (!selected && scanDone) { // only once the scan is done, or it flashes "not found"
    const when = granularity === 'day' ? `on ${format(anchor, 'MMM d, yyyy')}` : `in this ${granularity}`
    if (!sessions.length) missing = { text: `No sessions recorded ${when}.` }
    // Only a deep link explains itself — a hand-picked session missing from another date is just deselected
    else if (deepLink?.date === format(anchor, 'yyyy-MM-dd')) missing = { text: `Session ${selectedId} has no records ${when}.`, warn: true }
  }

  // `link` is set only by the deep-link handler below — picking a session by hand clears the notice
  const selectSession = useCallback((id, link = null) => {
    closeFind() // Close find synchronously on switch so the new transcript renders with forceMount off (no lag)
    setSelectedId(id)
    setDeepLink(link)
  }, [])

  // Deep link (claude-discover://session?id=…&date=…): jump to the session's day and select it
  useEffect(() => {
    const open = ({ id, date }) => {
      const day = date && parse(date, 'yyyy-MM-dd', new Date())
      if (day && !isNaN(day)) { // without a usable date just select within the period already shown
        setGranularity('day')
        setAnchor(startOfPeriod(day, 'day'))
        setSourceFilter(null) // filters could hide the session from the list
        setProjectFilter([])
      }
      selectSession(id, { id, date })
    }
    window.api.takeDeepLink().then(target => target && open(target)) // the link that cold-started us
    return window.api.onDeepLink(open)
  }, [selectSession, setGranularity])

  const shiftPeriod = useCallback((delta) => {
    setAnchor((a) => startOfPeriod(addPeriod(a, granularity, delta), granularity))
  }, [granularity])

  // Stable, so the memoized GanttChart skips App renders that don't touch it
  const toggleExpanded  = useCallback(key => setExpandedProjects(cur => cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]), [setExpandedProjects])
  const showAllProjects = useCallback(() => setProjectFilter([]), [setProjectFilter])

  const changeGranularity = useCallback((g) => {
    // Snap to the LAST sub-period of the current window (e.g. month → its final week/day), capped at today
    setAnchor((a) => startOfPeriod(Math.min(endOfPeriod(a, granularity), Date.now()), g))
    setGranularity(g)
  }, [granularity, setGranularity])

  if (loading) {
    return <div className="app-loading">Loading sessions…</div>
  }

  return (
    <div className="app">
    <Group
      orientation="vertical"
      disableCursor
      className="app-main"
      defaultLayout={rootLayout}
      onLayoutChanged={onRootLayoutChanged}
    >
      <Panel id="gantt" defaultSize={450} minSize={180} className="gantt-pane">
        <Toolbar
          granularity={granularity}
          onSetGranularity={changeGranularity}
          dayAnchor={anchor}
          onShiftDay={shiftPeriod}
          onResetToday={() => setAnchor(startOfPeriod(Date.now(), granularity))}
          sourceFilter={sourceFilter}
          availableSources={dayItems.availableSources}
          onToggleSourceFilter={(src) => setSourceFilter((cur) => (cur === src ? null : src))}
          projects={dayItems.projects}
          projectFilter={projectFilter}
          onSetProjectFilter={setProjectFilter}
        />
        <div className="gantt-body">
          <GanttChart
            dayRange={dayRange}
            sessions={dayItems.past}
            onSelect={selectSession}
            selectedId={selected?.filePath ?? null}
            dayAnchor={anchor}
            granularity={granularity}
            expanded={expandedProjects}
            onToggleExpanded={toggleExpanded}
            otherProjects={projectFilter.length ? dayItems.projects.filter(p => !projectFilter.includes(p.key)).length : 0}
            onShowAllProjects={showAllProjects}
          />
          <PeriodSummary sessions={dayItems.past} dayAnchor={anchor} granularity={granularity} expanded={expandedProjects} />
        </div>
      </Panel>
      <Separator className="resize-handle resize-handle-h" />
      <Panel id="body" minSize={20} className="body-outer">
        <Group
          orientation="horizontal"
          disableCursor
          className="body"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
        <Panel id="list" defaultSize={450} minSize={200} maxSize={700} className="body-pane">
          <SessionList
            sessions={dayItems.past}
            selectedId={selected?.filePath ?? null}
            deepLink={deepLink}
            onSelect={selectSession}
          />
        </Panel>
        <Separator className="resize-handle resize-handle-v" />
        <Panel id="detail" minSize={30} className="body-pane">
          {/* one transcript that fails to render must not take the timeline down with it */}
          <PaneErrorBoundary title="Couldn't render this session" resetKeys={[selected?.filePath, anchor, granularity]}>
            <Session meta={selected} missing={missing} date={format(anchor, 'yyyy-MM-dd')} granularity={granularity} onShowPeriodOf={ts => setAnchor(startOfPeriod(ts, granularity))} />
          </PaneErrorBoundary>
        </Panel>
        </Group>
      </Panel>
    </Group>
    <StatusBar sessionCount={sessions.length} />
    </div>
  )
}
