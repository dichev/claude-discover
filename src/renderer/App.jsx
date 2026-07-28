import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import GanttChart from './timeline/GanttChart.jsx'
import Toolbar from './timeline/Toolbar.jsx'
import PeriodSummary from './timeline/PeriodSummary.jsx'
import SessionList from './sessions/SessionList.jsx'
import Session from './sessions/Session.jsx'
import StatusBar from './ui/StatusBar.jsx'
import { closeFind } from './ui/useFindActive.js'
import { format, parse } from 'date-fns'
import { startOfPeriod, endOfPeriod, addPeriod } from './utils/period.js'
import { useLocalStorage } from './utils/useLocalStorage.js'
import './App.css'

export default function App() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [scanProgress, setScanProgress] = useState(null)
  const [granularity, setGranularity] = useLocalStorage('gantt.granularity', 'day')
  const [anchor, setAnchor] = useState(() => startOfPeriod(Date.now(), granularity))
  const [selectedId, setSelectedId] = useState(null)
  const [deepLink, setDeepLink] = useState(null) // the link the current selection came from, if any
  const [sourceFilter, setSourceFilter] = useState(null)
  const [projectFilter, setProjectFilter] = useState(null)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'app.body', panelIds: ['list', 'detail'], storage: localStorage })
  const { defaultLayout: rootLayout, onLayoutChanged: onRootLayoutChanged } = useDefaultLayout({ id: 'app.root', panelIds: ['gantt', 'body'], storage: localStorage })

  const dayRange = useMemo(() => {
    const start = anchor
    const end = endOfPeriod(anchor, granularity)
    return { start, end }
  }, [anchor, granularity])

  useEffect(() => {
    let cancelled = false
    setScanProgress(null) // fresh scan for this period
    const offP = window.api.onScanProgress((p) => { if (!cancelled) setScanProgress(p) }) // before listSessions so the initial done:0 isn't missed
    const timer = setTimeout(() => {
      window.api.listSessions(format(anchor, 'yyyy-MM-dd'), granularity)
        .then((s) => {
          if (!cancelled) { setSessions(s || []); setLoading(false) }
        })
    }, 120)
    const off = window.api.onSessionsUpdate((s) => { if (!cancelled) setSessions(s || [])
     })
    return () => { cancelled = true
     clearTimeout(timer)
     off()
     offP()
     }
  }, [anchor, granularity])

  const dayItems = useMemo(() => {
    const sourceFiltered = sourceFilter ? sessions.filter((s) => (s.source || 'other') === sourceFilter) : sessions
    const past = projectFilter ? sourceFiltered.filter((s) => (s.project || '(no project)') === projectFilter) : sourceFiltered
    const availableSources = [...new Set(sessions.map((s) => s.source || 'other'))]
    return { sourceFiltered, past, availableSources }
  }, [sessions, sourceFilter, projectFilter])

  const selected = useMemo(
    () => sessions.find((s) => s.sessionId === selectedId) || null,
    [sessions, selectedId]
  )

  // Say why the detail pane is empty instead of just showing nothing
  let missing = null
  if (!selected && scanProgress?.scanning === false) { // only once the scan is done, or it flashes "not found"
    const when = granularity === 'day' ? `on ${format(anchor, 'MMM d, yyyy')}` : `in this ${granularity}`
    if (!sessions.length) missing = `No sessions recorded ${when}.`
    // Only a deep link explains itself — a hand-picked session missing from another date is just deselected
    else if (deepLink?.date === format(anchor, 'yyyy-MM-dd')) missing = `Session ${selectedId} has no records ${when}.`
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
        setProjectFilter(null)
      }
      selectSession(id, { id, date })
    }
    window.api.takeDeepLink().then(target => target && open(target)) // the link that cold-started us
    return window.api.onDeepLink(open)
  }, [selectSession, setGranularity])

  const shiftPeriod = useCallback((delta) => {
    setProjectFilter(null)
    setAnchor((a) => startOfPeriod(addPeriod(a, granularity, delta), granularity))
  }, [granularity])

  const changeGranularity = useCallback((g) => {
    setProjectFilter(null)
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
      className="app-main"
      defaultLayout={rootLayout}
      onLayoutChanged={onRootLayoutChanged}
    >
      <Panel id="gantt" defaultSize={400} minSize={180} className="gantt-pane">
        <Toolbar
          granularity={granularity}
          onSetGranularity={changeGranularity}
          dayAnchor={anchor}
          onShiftDay={shiftPeriod}
          onResetToday={() => { setProjectFilter(null); setAnchor(startOfPeriod(Date.now(), granularity)) }}
          sourceFilter={sourceFilter}
          availableSources={dayItems.availableSources}
          onToggleSourceFilter={(src) => setSourceFilter((cur) => (cur === src ? null : src))}
        />
        <div className="gantt-body">
          <GanttChart
            dayRange={dayRange}
            sessions={dayItems.sourceFiltered}
            onSelect={selectSession}
            selectedId={selectedId}
            dayAnchor={anchor}
            granularity={granularity}
            projectFilter={projectFilter}
            onToggleProjectFilter={(project) => setProjectFilter((cur) => (cur === project ? null : project))}
          />
          <PeriodSummary sessions={dayItems.past} dayAnchor={anchor} granularity={granularity} />
        </div>
      </Panel>
      <Separator className="resize-handle resize-handle-h" />
      <Panel id="body" minSize={20} className="body-outer">
        <Group
          orientation="horizontal"
          className="body"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
        <Panel id="list" defaultSize={350} minSize={200} maxSize={700} className="body-pane">
          <SessionList
            sessions={dayItems.past}
            selectedId={selectedId}
            deepLink={deepLink}
            onSelect={selectSession}
          />
        </Panel>
        <Separator className="resize-handle resize-handle-v" />
        <Panel id="detail" minSize={30} className="body-pane">
          <Session meta={selected} missing={missing} date={format(anchor, 'yyyy-MM-dd')} granularity={granularity} />
        </Panel>
        </Group>
      </Panel>
    </Group>
    <StatusBar progress={scanProgress} sessionCount={sessions.length} />
    </div>
  )
}
