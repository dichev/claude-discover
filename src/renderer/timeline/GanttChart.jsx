import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { format, startOfDay, isSameDay } from 'date-fns'
import { SOURCE_COLORS, SOURCE_LABELS } from '../utils/colors.js'
import { useLocalStorage } from '../utils/useLocalStorage.js'
import HeatStrip from './HeatStrip.jsx'
import WorkTimeOverlay from './WorkTimeOverlay.jsx'
import './GanttChart.css'

const LANE_HEIGHT = 22
const LANE_GAP = 4
const HEADER_HEIGHT = 28
const MIN_BAR_PX = 4
const GUTTER_WIDTH = 220
const GROUP_GAP = 8

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

function minorIntervalFor(span) {
  if (span < 15 * 60_000)   return 60_000        // < 15 min  → 1 min
  if (span < 60 * 60_000)   return 5 * 60_000    // < 1 h     → 5 min
  if (span < 3 * 3600_000)  return 10 * 60_000   // < 3 h     → 10 min
  if (span < 12 * 3600_000) return 30 * 60_000   // < 12 h    → 30 min
  return null
}

function HourTicks({ viewStart, viewEnd, width, span }) {
  const step = minorIntervalFor(span) ?? 3600_000
  const intervalMin = step / 60_000

  const t0 = new Date(viewStart)
  t0.setSeconds(0, 0)
  t0.setMinutes(t0.getMinutes() - (t0.getMinutes() % intervalMin))
  if (t0.getTime() < viewStart) t0.setMinutes(t0.getMinutes() + intervalMin)

  const ticks = []
  for (let t = t0.getTime(); t <= viewEnd; t += step) {
    const d = new Date(t)
    const major = d.getMinutes() === 0
    const label = major ? String(d.getHours()).padStart(2, '0') : `:${String(d.getMinutes()).padStart(2, '0')}`
    ticks.push({ x: ((t - viewStart) / span) * width, label, major })
  }

  return (
    <g className="ticks">
      {ticks.map((tk, i) => (
        <g key={i} transform={`translate(${tk.x},0)`}>
          <line y1={0} y2={HEADER_HEIGHT} className={`tick-hline ${tk.major ? 'tick-major' : 'tick-minor'}`} />
          <line y1={HEADER_HEIGHT} y2="100%" className={`tick-vline ${tk.major ? 'tick-major' : 'tick-minor'}`} />
          <text x={4} y={14} className={`tick-text ${tk.major ? 'tick-major' : 'tick-minor'}`}>{tk.label}</text>
        </g>
      ))}
    </g>
  )
}

export default function GanttChart({
  dayRange, sessions, onSelect, selectedId, onShiftDay, onResetToday, dayAnchor,
  sourceFilter, onToggleSourceFilter, cwdFilter, onToggleCwdFilter,
}) {
  const containerRef = useRef(null)
  const [width, setWidth] = useState(1200)
  const [view, setView] = useLocalStorage('gantt-chart.view', { dayAnchor, start: dayRange.start, end: dayRange.end })

  useEffect(() => {
    if (view.dayAnchor !== dayAnchor) setView({ dayAnchor, start: dayRange.start, end: dayRange.end })
  }, [dayAnchor])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(400, e.contentRect.width))
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const { groups, totalHeight } = useMemo(() => {
    const byKey = new Map()
    for (const s of sessions) {
      const item = {
        id: s.sessionId,
        label: s.summary || s.firstUserPrompt || s.firstUserCommand || s.sessionId,
        start: s.startedAt,
        end: Math.max(s.lastActivityAt, s.startedAt + 60_000),
        source: s.source,
        activityPeriods: s.activityPeriods,
        cacheCreation1h: s.tokens.cacheCreation1h || 0,
      }
      const key = s.cwd || '(no cwd)'
      let group = byKey.get(key)
      if (!group) byKey.set(key, group = { cwdShort: s.cwdShort, items: [] })
      group.items.push(item)
    }
    const arr = [...byKey.entries()].map(([key, { cwdShort, items }]) => {
      const { placed, laneCount } = packLanes(items)
      const activity = items.reduce((sum, i) => sum + (i.end - i.start), 0)
      return { key, cwdShort, placed, laneCount, activity }
    })
    arr.sort((a, b) => b.activity - a.activity)
    let y = HEADER_HEIGHT
    for (const g of arr) {
      g.yOffset = y
      g.height = g.laneCount * (LANE_HEIGHT + LANE_GAP)
      y += g.height + GROUP_GAP
    }
    return { groups: arr, totalHeight: Math.max(HEADER_HEIGHT + LANE_HEIGHT + 12, y + 4) }
  }, [sessions])

  const chartWidth = Math.max(100, width - GUTTER_WIDTH)
  const span = view.end - view.start
  const xFor = (ts) => GUTTER_WIDTH + ((ts - view.start) / span) * chartWidth

  const onWheel = useCallback((e) => {
    if (!(e.shiftKey || e.ctrlKey) && e.deltaX === 0) return
    e.preventDefault()
    const rect = containerRef.current.getBoundingClientRect()
    const xInCanvas = e.clientX - rect.left
    const ratio = Math.min(1, Math.max(0, (xInCanvas - GUTTER_WIDTH) / chartWidth))
    if (e.shiftKey || e.ctrlKey) {
      const newSpan = Math.max(60_000, Math.min(7 * 86400_000, span * Math.exp(e.deltaY * 0.0015)))
      const center = view.start + ratio * span
      const start = Math.max(dayRange.start, center - ratio * newSpan)
      const end = Math.min(dayRange.end, center + (1 - ratio) * newSpan)
      setView((v) => ({ ...v, start, end }))
    } else {
      const dt = (e.deltaX / chartWidth) * span
      setView((v) => {
        const newStart = Math.max(dayRange.start, v.start + dt)
        const newEnd = Math.min(dayRange.end, v.end + dt)
        return newEnd - newStart < span ? v : { ...v, start: newStart, end: newEnd }
      })
    }
  }, [span, view.start, chartWidth, dayRange])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const handleMouseDown = useCallback((e) => {
    let startX = e.clientX
    const handleMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX
      const dt = (deltaX / chartWidth) * span
      setView((v) => {
        const newStart = Math.max(dayRange.start, v.start - dt)
        const newEnd = Math.min(dayRange.end, v.end - dt)
        return newEnd - newStart < span ? v : { ...v, start: newStart, end: newEnd }
      })
      startX = moveEvent.clientX
    }
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [chartWidth, span, dayRange])

  return (
    <div className="gantt-wrap">
      <div className="gantt-toolbar">
        <div className="gantt-pill-wrap">
          <div className="gantt-controls">
            <button className="gantt-nav-btn" onClick={() => onShiftDay(-1)} title="Previous day" aria-label="Previous day">←</button>
            <span className="gantt-date-label">{format(dayAnchor, 'MMM d')}</span>
            <button
              className="gantt-nav-btn"
              onClick={() => onShiftDay(1)}
              title="Next day"
              aria-label="Next day"
              style={{ visibility: isSameDay(dayAnchor, startOfDay(Date.now())) ? 'hidden' : 'visible' }}
            >→</button>
          </div>
          <button
            className="gantt-today-btn"
            onClick={onResetToday}
            style={{ visibility: isSameDay(dayAnchor, startOfDay(Date.now())) ? 'hidden' : 'visible' }}
          >Today</button>
        </div>
        <div className="gantt-legend">
          {['cli','sdk','desktop','scheduled','other'].map((k) => {
            const active = sourceFilter === k
            const dim = sourceFilter && !active
            return (
              <button key={k} type="button" className={`legend-chip ${active ? 'active' : ''} ${dim ? 'dim' : ''}`} onClick={() => onToggleSourceFilter?.(k)}>
                <span className="swatch" style={{ background: SOURCE_COLORS[k] }} />
                {SOURCE_LABELS[k]}
              </button>
            )
          })}
        </div>
      </div>
      <HeatStrip
        sessions={sessions}
        viewStart={view.start}
        viewEnd={view.end}
        width={width}
        gutter={GUTTER_WIDTH}
      />
      <div className="gantt-canvas" ref={containerRef} onMouseDown={handleMouseDown}>
        <svg width={width} height={totalHeight}>
          <rect x={0} y={0} width={GUTTER_WIDTH} height={totalHeight} className="gantt-gutter" />
          <line x1={GUTTER_WIDTH} x2={GUTTER_WIDTH} y1={0} y2={totalHeight} className="gantt-divider" />
          <g transform={`translate(${GUTTER_WIDTH},0)`}>
            <HourTicks viewStart={view.start} viewEnd={view.end} width={chartWidth} span={span} />
          </g>
          {groups.map((g, gi) => (
            <g key={g.key} style={cwdFilter && cwdFilter !== g.key ? { opacity: 0.25 } : undefined}>
              {gi > 0 && (
                <line
                  x1={0} x2={width}
                  y1={g.yOffset - GROUP_GAP / 2}
                  y2={g.yOffset - GROUP_GAP / 2}
                  className="gantt-group-sep"
                />
              )}
              <text
                x={8} y={g.yOffset + 14}
                className={`gantt-cwd gantt-cwd-clickable${cwdFilter === g.key ? ' gantt-cwd-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onToggleCwdFilter?.(g.key) }}
              >
                <title>{g.key}</title>
                {g.cwdShort}
              </text>
              {g.placed.map(({ item, lane }) => {
                const y = g.yOffset + lane * (LANE_HEIGHT + LANE_GAP)
                const color = SOURCE_COLORS[item.source] || SOURCE_COLORS.other
                const isSelected = item.id === selectedId
                const periods = item.activityPeriods?.length
                  ? item.activityPeriods
                  : [{ start: item.start, end: item.end }]

                const rawX1 = xFor(item.start)
                const rawX2 = xFor(item.end)
                if (rawX2 < GUTTER_WIDTH || rawX1 > width) return null
                const x = Math.max(GUTTER_WIDTH, rawX1)
                const w = Math.max(MIN_BAR_PX, Math.min(width, rawX2) - x)

                return (
                  <g key={item.id} className={`bar ${isSelected ? 'selected' : ''}`}
                     onClick={() => onSelect(item.id)}>
                    <rect x={x} y={y} width={w} height={LANE_HEIGHT} rx={3} fill={color} className="bar-fill" />
                    {item.cacheCreation1h > 0 && (
                      <>
                        <clipPath id={`warn-clip-${item.id}`}>
                          <rect x={x} y={y} width={w} height={LANE_HEIGHT} rx={3} />
                        </clipPath>
                        <rect x={x} y={y + LANE_HEIGHT - 3} width={w} height={3} className="gantt-cache-bar" clipPath={`url(#warn-clip-${item.id})`} />
                      </>
                    )}
                    {periods.slice(0, -1).map((p, i) => {
                      const gx1 = Math.max(GUTTER_WIDTH, xFor(p.end))
                      const gx2 = Math.min(width, xFor(periods[i + 1].start))
                      if (gx2 <= gx1) return null
                      return <rect key={i} x={gx1} y={y} width={gx2 - gx1} height={LANE_HEIGHT} className="gantt-idle" />
                    })}
                    {isSelected && (
                      <rect x={x} y={y} width={w} height={LANE_HEIGHT} rx={3} className="bar-outline" />
                    )}
                    <title>{`${SOURCE_LABELS[item.source] || item.source} · ${item.label}\n${g.key}\n${new Date(item.start).toLocaleString()} → ${new Date(item.end).toLocaleString()}${item.cacheCreation1h > 0 ? '\n· uses 1h extended cache' : ''}`}</title>
                  </g>
                )
              })}
            </g>
          ))}
          <WorkTimeOverlay
            dayStart={dayRange.start}
            viewStart={view.start}
            viewEnd={view.end}
            chartLeft={GUTTER_WIDTH}
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
