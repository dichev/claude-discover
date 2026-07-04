import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import GanttChart from './timeline/GanttChart.jsx'
import Toolbar from './timeline/Toolbar.jsx'
import PeriodSummary from './timeline/PeriodSummary.jsx'
import SessionList from './sessions/SessionList.jsx'
import SessionView from './sessions/SessionView.jsx'
import StatusBar from './ui/StatusBar.jsx'
import { closeFind } from './ui/useFindActive.js'
import { format } from 'date-fns'
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

  const selectSession = useCallback((id) => {
    closeFind() // Close find synchronously on switch so the new transcript renders with forceMount off (no lag)
    setSelectedId(id)
  }, [])

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
      <Panel id="gantt" defaultSize={500} minSize={180} className="gantt-pane">
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
            onSelect={selectSession}
          />
        </Panel>
        <Separator className="resize-handle resize-handle-v" />
        <Panel id="detail" minSize={30} className="body-pane">
          <SessionView meta={selected} date={format(anchor, 'yyyy-MM-dd')} granularity={granularity} />
        </Panel>
        </Group>
      </Panel>
    </Group>
    <StatusBar progress={scanProgress} sessionCount={sessions.length} />
    </div>
  )
}
