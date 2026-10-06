import { useEffect, useMemo, useRef, useState } from 'react'
import { SOURCE_COLORS, SOURCE_LABELS } from '../utils/colors.js'
import { useLocalStorage } from '../utils/useLocalStorage.js'
import { useMouse } from '../utils/useMouse.js'
import { subagentClusters, isJournal } from '../utils/subagents.js'
import HeatStrip from './HeatStrip.jsx'
import TimeAxis, { computeTicks } from './TimeAxis.jsx'
import WorkTimeOverlay from './WorkTimeOverlay.jsx'
import './GanttChart.css'

const HEADER_HEIGHT  = 28
const PROJECTS_WIDTH = 220
const LABEL_LINE     = 15 // one line of 11px label text, e.g. "N dirs grouped" below the project name
const LABEL_X        = 22 // every project label leaves room for the expand chevron, so names stay aligned
const BARS = {
  day:   { height: 16, min_width: 4, row_gap: 2, group_gap: 6, radius: 3 },
  week:  { height: 12, min_width: 3, row_gap: 2, group_gap: 3, radius: 2 },
  month: { height: 10, min_width: 2, row_gap: 2, group_gap: 2, radius: 1 },
}

const SUBAGENT_SPLIT_GAP = 5 * 60_000 // a longer pause between subagents (user working) splits them into separate bars
const endOf = (s) => Math.max(s.lastActivityAt, s.startedAt + 60_000)
const clipLeft = (s, n = 29) => s.length > n ? '…' + s.slice(1 - n) : s // keep the distinctive tail of a long subfolder

function packLanes(items) {
  const lanes = []
  const placed = items
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((item) => {
      let lane = lanes.findIndex((endTs) => endTs <= item.start)
      if (lane === -1) { lane = lanes.length
       lanes.push(item.end)
       }
      else { lanes[lane] = item.end
       }
      return { item, lane }
    })
  return { placed, laneCount: Math.max(1, lanes.length) }
}

export default function GanttChart({
  dayRange, sessions, onSelect, selectedId, dayAnchor,
  granularity = 'day', expanded, onToggleExpanded, otherProjects, onShowAllProjects,
}) {
  const bar = BARS[granularity] ?? BARS.day
  const containerRef = useRef(null)
  const [width, setWidth] = useState(1200)
  const [view, setView]   = useLocalStorage('gantt-chart.view', { dayAnchor, granularity, start: dayRange.start, end: dayRange.end })

  useEffect(() => {
    if (view.dayAnchor !== dayAnchor || view.granularity !== granularity) {
      setView({ dayAnchor, granularity, start: dayRange.start, end: dayRange.end })
    }
  }, [dayAnchor, granularity])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(400, e.contentRect.width))
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const { groups, totalHeight } = useMemo(() => {
    // Subagents split into time-separated runs; a run of 2+ collapses into one labelled bar.
    const clusters = subagentClusters(sessions, SUBAGENT_SPLIT_GAP).filter((c) => c.length >= 2)
    const collapsed = new Set(clusters.flat().map((s) => s.filePath))

    const byKey = new Map()
    const addItem = (s, item, cost) => {
      const key = s.project || '(no project)'
      let group = byKey.get(key)
      if (!group) byKey.set(key, group = { key, projectShort: s.projectShort, temp: false, byDir: new Map(), cost: 0 })
      group.temp ||= !!s.tempPath
      item.dir = s.tempTag ?? s.subdir ?? ''
      let row = group.byDir.get(item.dir)
      if (!row) group.byDir.set(item.dir, row = { dir: item.dir, items: [], cost: 0 })
      row.items.push(item)
      row.cost += cost || 0
      group.cost += cost || 0
    }

    for (const s of sessions) {
      if (collapsed.has(s.filePath)) continue
      addItem(s, {
        id: s.filePath,
        label: s.summary || s.firstUserPrompt || s.firstUserCommand || s.sessionId,
        start: s.startedAt,
        end: endOf(s),
        source: s.source,
        activityPeriods: s.activityPeriods,
      }, s.cost)
    }

    for (const subs of clusters) {
      const periods = subs.map((c) => ({ start: c.startedAt, end: endOf(c) }))
      addItem(subs[0], {
        id: `${subs[0].filePath}::subagents`,
        start: periods[0].start,
        end: Math.max(...periods.map((p) => p.end)),
        source: subs[0].source,
        activityPeriods: periods,
        subs,
        subCount: subs.filter(c => !isJournal(c)).length, // journals are workflow logs, not subagents
      }, subs.reduce((sum, c) => sum + (c.cost || 0), 0))
    }
    const lane = bar.height + bar.row_gap
    const arr = [...byKey.values()].sort((a, b) => a.temp - b.temp || b.cost - a.cost)
    let y = HEADER_HEIGHT
    for (const g of arr) {
      g.yOffset = y
      g.dirs = g.byDir.size - g.byDir.has('')
      g.expanded = g.dirs > 0 && expanded.includes(g.key)
      const rows = g.expanded
        ? [...g.byDir.values()].sort((a, b) => !!a.dir - !!b.dir || b.cost - a.cost)
        : [{ items: [...g.byDir.values()].flatMap(r => r.items) }]
      // Expanded, the project name gets a line of its own above the per-subfolder rows
      let rowY = g.expanded ? y + Math.max(LABEL_LINE, lane) : y
      g.placed = []
      g.labels = g.dirs > 0 && !g.expanded ? [{ text: `${g.dirs} dir${g.dirs === 1 ? '' : 's'} grouped`, x: LABEL_X, y: y + bar.height / 2 + LABEL_LINE }] : []
      for (const row of rows) {
        const { placed, laneCount } = packLanes(row.items)
        if (g.expanded) g.labels.push({ text: clipLeft(row.dir || '(root)'), title: row.dir, x: LABEL_X + 8, y: rowY + bar.height / 2 })
        for (const p of placed) g.placed.push({ item: p.item, y: rowY + p.lane * lane })
        rowY += g.expanded ? Math.max(laneCount * lane, LABEL_LINE) : laneCount * lane // month lanes are shorter than a label
      }
      g.height = Math.max(rowY - y, ...g.labels.map(l => l.y + 6 - y)) // tall enough for the lowest label
      y += g.height + bar.group_gap
    }
    return { groups: arr, totalHeight: Math.max(HEADER_HEIGHT + bar.height + 12, y + 4) }
  }, [sessions, granularity, expanded])

  const chartWidth = Math.max(100, width - PROJECTS_WIDTH)
  const span = view.end - view.start
  const xFor = (ts) => PROJECTS_WIDTH + ((ts - view.start) / span) * chartWidth

  const ticks = useMemo(
    () => computeTicks({ viewStart: view.start, viewEnd: view.end, width: chartWidth, span }),
    [view.start, view.end, chartWidth, span],
  )

  useMouse(containerRef, {
    onZoom: (e) => { // cursor-anchored: the timestamp under the pointer stays put
      const rect = containerRef.current.getBoundingClientRect()
      const xInCanvas = e.clientX - rect.left
      const ratio = Math.min(1, Math.max(0, (xInCanvas - PROJECTS_WIDTH) / chartWidth))
      const newSpan = Math.max(60_000, Math.min(dayRange.end - dayRange.start, span * Math.exp(e.deltaY * 0.0015)))
      const center = view.start + ratio * span
      const start = Math.max(dayRange.start, center - ratio * newSpan)
      const end = Math.min(dayRange.end, center + (1 - ratio) * newSpan)
      setView((v) => ({ ...v, start, end }))
    },
    onReset: () => setView((v) => ({ ...v, start: dayRange.start, end: dayRange.end })),
    onPan: (dx) => {
      const dt = (dx / chartWidth) * span
      setView((v) => {
        const newStart = Math.max(dayRange.start, v.start + dt)
        const newEnd = Math.min(dayRange.end, v.end + dt)
        return newEnd - newStart < span ? v : { ...v, start: newStart, end: newEnd }
      })
    },
  })

  return (
    <div className="gantt-wrap">
      <HeatStrip
        sessions={sessions}
        viewStart={view.start}
        viewEnd={view.end}
        width={width}
        gutter={PROJECTS_WIDTH}
      />
      <div className="gantt-canvas" ref={containerRef}>
        <svg width={width} height={totalHeight}>
          <defs>
            <pattern id="gantt-subagent-hatch" patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={5} stroke="#0b0e14" strokeWidth={3.5} />
            </pattern>
          </defs>
          <rect x={0} y={0} width={PROJECTS_WIDTH} height={totalHeight} className="gantt-gutter" />
          <line x1={PROJECTS_WIDTH} x2={PROJECTS_WIDTH} y1={0} y2={totalHeight} className="gantt-divider" />
          <g transform={`translate(${PROJECTS_WIDTH},0)`}>
            {ticks.map((tk, i) => (
              <line
                key={i}
                x1={tk.x} x2={tk.x}
                y1={HEADER_HEIGHT} y2={totalHeight}
                className={`tick-vline ${tk.major ? 'tick-major' : 'tick-minor'}`}
              />
            ))}
            <TimeAxis viewStart={view.start} viewEnd={view.end} width={chartWidth} span={span} headerHeight={HEADER_HEIGHT} />
          </g>
          {otherProjects > 0 && ( // the project picker hides the rest — point back to them from the axis row
            <text
              x={LABEL_X} y={HEADER_HEIGHT / 2}
              dominantBaseline="central"
              className="gantt-project-more"
              onClick={e => { e.stopPropagation(); onShowAllProjects() }}
            >
              ({otherProjects} hidden project{otherProjects === 1 ? '' : 's'})
            </text>
          )}
          {groups.map((g, gi) => (
            <g key={g.key}>
              {gi > 0 && (
                <line
                  x1={0} x2={width}
                  y1={g.yOffset - bar.group_gap / 2}
                  y2={g.yOffset - bar.group_gap / 2}
                  className="gantt-group-sep"
                />
              )}
              <g
                className={g.dirs > 0 ? 'gantt-project-clickable' : undefined}
                onClick={g.dirs > 0 ? e => { e.stopPropagation(); onToggleExpanded(g.key) } : undefined}
              >
                {g.dirs > 0 && (
                  <text x={6} y={g.yOffset + bar.height / 2} dominantBaseline="central" className="gantt-project-toggle">
                    {g.expanded ? '▾' : '▸'}
                  </text>
                )}
                <text x={LABEL_X} y={g.yOffset + bar.height / 2} dominantBaseline="central" className="gantt-project">
                  <title>{g.key}</title>
                  {g.projectShort}
                </text>
              </g>
              {g.labels.map(l => (
                <text key={l.y} x={l.x} y={l.y} dominantBaseline="central" className="gantt-project-dir">
                  {l.title && <title>{l.title}</title>}
                  {l.text}
                </text>
              ))}
              {g.placed.map(({ item, y }) => {
                const color = SOURCE_COLORS[item.source] || SOURCE_COLORS.other
                const isSelected = item.subs ? item.subs.some((c) => c.filePath === selectedId) : item.id === selectedId
                const periods = item.activityPeriods?.length
                  ? item.activityPeriods
                  : [{ start: item.start, end: item.end }]

                const rawX1 = xFor(item.start)
                const rawX2 = xFor(item.end)
                if (rawX2 < PROJECTS_WIDTH || rawX1 > width) return null
                const x = Math.max(PROJECTS_WIDTH, rawX1)
                const w = Math.max(bar.min_width, Math.min(width, rawX2) - x)

                return (
                  <g key={item.id} className={`bar ${isSelected ? 'selected' : ''}`}
                     onClick={() => onSelect(item.subs ? item.subs.at(-1).filePath : item.id)}>
                    <rect x={x} y={y} width={w} height={bar.height} rx={bar.radius} fill={color} className="bar-fill" />
                    {periods.slice(0, -1).map((p, i) => {
                      const gx1 = Math.max(PROJECTS_WIDTH, xFor(p.end))
                      const gx2 = Math.min(width, xFor(periods[i + 1].start))
                      if (gx2 <= gx1) return null
                      return <rect key={i} x={gx1} y={y} width={gx2 - gx1} height={bar.height} className="gantt-idle" />
                    })}
                    {item.subs && (
                      <rect x={x} y={y} width={w} height={bar.height} rx={bar.radius} fill="url(#gantt-subagent-hatch)" opacity={0.5} pointerEvents="none" />
                    )}
                    {item.subs && (
                      <text x={x + w / 2} y={y + bar.height / 2} textAnchor="middle" dominantBaseline="central" className="gantt-bar-count">
                        {item.subCount}
                      </text>
                    )}
                    {isSelected && (
                      <rect x={x} y={y} width={w} height={bar.height} rx={bar.radius} className="bar-outline" />
                    )}
                    <title>{`${item.subs ? `${item.subCount} subagents` : `${SOURCE_LABELS[item.source] || item.source} · ${item.label}`}\n${item.dir ? `${g.key} › ${item.dir}` : g.key}\n${new Date(item.start).toLocaleString()} → ${new Date(item.end).toLocaleString()}`}</title>
                  </g>
                )
              })}
            </g>
          ))}
          <WorkTimeOverlay
            showWorkBand={granularity === 'day'}
            dayStart={dayRange.start}
            viewStart={view.start}
            viewEnd={view.end}
            chartLeft={PROJECTS_WIDTH}
            chartWidth={chartWidth}
            totalHeight={totalHeight}
            headerHeight={HEADER_HEIGHT}
            containerRef={containerRef}
          />
        </svg>
      </div>
    </div>
  )
}
