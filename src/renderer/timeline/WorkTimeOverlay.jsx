import React, { useEffect, useState } from 'react'
import { THRESHOLDS as T } from '../utils/thresholds.js'
import { tone } from '../utils/formatting.js'
import './WorkTimeOverlay.css'

const SNAP_MIN = 5
const LIMITS = [
  { key: 'five_hour', label: '5h', windowMs: 5 * 3600_000,  thresholds: T.usage5h },
  { key: 'seven_day', label: '7d', windowMs: 7 * 86400_000, thresholds: T.usage7d },
]


const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
const fmtHM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const parseHM = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }



export default function WorkTimeOverlay({
  showWorkBand = true, dayStart, viewStart, viewEnd, chartLeft, chartWidth, totalHeight, headerHeight, containerRef,
}) {
  const [workTime, setWorkTime] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [now,      setNow]      = useState(() => Date.now())
  const [usage,    setUsage]    = useState(null)

  useEffect(() => {
    window.api.getWorkHours().then(({ work_hours: w }) => setWorkTime({ startMin: parseHM(w.start), endMin: parseHM(w.end) }))
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const apply = u => { if (u) setUsage(u) }
    window.api.getAgentUsage().then(apply)
    return window.api.onAgentUsage(apply)
  }, [])

  useEffect(() => {
    if (workTime) window.api.setWorkHours({ work_hours: { start: fmtHM(workTime.startMin), end: fmtHM(workTime.endMin) } })
  }, [workTime])

  if (!workTime) return null

  const chartRight = chartLeft + chartWidth
  const xForMin = (min) => chartLeft + ((dayStart + min * 60_000 - viewStart) / (viewEnd - viewStart)) * chartWidth
  const xStart = xForMin(workTime.startMin)
  const xEnd = xForMin(workTime.endMin)

  const startDrag = (which) => (e) => {
    e.stopPropagation()
    e.preventDefault()
    setDragging(which)
    const onMove = (m) => {
      const rect = containerRef.current.getBoundingClientRect()
      const ratio = clamp((m.clientX - rect.left - chartLeft) / chartWidth, 0, 1)
      const ts = viewStart + ratio * (viewEnd - viewStart)
      const min = clamp(Math.round((ts - dayStart) / 60_000 / SNAP_MIN) * SNAP_MIN, 0, 24 * 60)
      setWorkTime((wt) => which === 'start'
        ? { ...wt, startMin: Math.min(min, wt.endMin - SNAP_MIN) }
        : { ...wt, endMin: Math.max(min, wt.startMin + SNAP_MIN) })
    }
    const onUp = () => {
      setDragging(null)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const renderHandle = (which, x, min) => {
    if (x < chartLeft || x > chartRight) return null
    const isDragging = dragging === which
    const labelOnLeft = which === 'end'
    return (
      <g className="work-handle" onMouseDown={startDrag(which)}>
        <rect className="work-handle-hit" x={x - 7} y={0} width={14} height={totalHeight} />
        <line className="work-handle-line" x1={x} x2={x} y1={0} y2={totalHeight} />
        <rect className="work-handle-grip" x={x - 4} y={6} width={8} height={16} rx={2} />
        <title>{`Work ${which}: ${fmtHM(min)}`}</title>
        {isDragging && (
          <foreignObject x={labelOnLeft ? x - 50 : x + 6} y={2} width={48} height={20} pointerEvents="none">
            <div className="work-handle-label">{fmtHM(min)}</div>
          </foreignObject>
        )}
      </g>
    )
  }

  const shadeL = clamp(xStart, chartLeft, chartRight)
  const shadeR = clamp(xEnd, chartLeft, chartRight)

  const xForTs = (ts) => chartLeft + ((ts - viewStart) / (viewEnd - viewStart)) * chartWidth
  const showNow = now >= viewStart && now <= viewEnd

  return (
    <g>
      <defs>
        <pattern id="work-offhours-stripes" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line className="work-offhours-stripe" x1={0} y1={0} x2={0} y2={8} />
        </pattern>
      </defs>
      {showWorkBand && (
        <g className="work-overlay">
          <rect className="work-offhours-shade" x={chartLeft} y={0} width={Math.max(0, shadeL - chartLeft)} height={totalHeight} />
          <rect className="work-offhours-shade" x={shadeR} y={0} width={Math.max(0, chartRight - shadeR)} height={totalHeight} />
          <g className="work-handles">
            {renderHandle('start', xStart, workTime.startMin)}
            {renderHandle('end', xEnd, workTime.endMin)}
          </g>
        </g>
      )}
      {showNow && (
        <g className="now-line">
          <line x1={xForTs(now)} x2={xForTs(now)} y1={0} y2={totalHeight} />
          <text x={xForTs(now) + 4} y={headerHeight - 2}>now</text>
        </g>
      )}
      {LIMITS.map(({ key, label, windowMs, thresholds }, i) => {
        const entry = usage?.[key]
        if (!entry?.resets_at) return null
        const ts = new Date(entry.resets_at).getTime()
        if (ts < viewStart) return null
        const pct = Math.round(entry.utilization)
        const projected = Math.round(pct / Math.max(0.05, 1 - (ts - now) / windowMs))
        const level = tone(projected, thresholds) || 'ok'
        const tooltip = `Claude usage ${label} limit (${pct}% used, ${projected}% projected), resets ${new Date(ts).toLocaleString()}`
        if (ts > viewEnd) {
          return (
            <g key={key} className={`limit-line limit-line-offscreen limit-${level}`}>
              <title>{tooltip}</title>
              <text x={chartRight - (i === 0 ? 64 : 4)} y={headerHeight - 2} textAnchor="end">{`${label} (${pct}%)`}</text>
            </g>
          )
        }
        const x = xForTs(ts)
        return (
          <g key={key} className={`limit-line limit-${level}`}>
            <title>{tooltip}</title>
            <line x1={x} x2={x} y1={0} y2={totalHeight} />
            <text x={x + 4} y={headerHeight - 2}>{`${label} limit (${pct}%)`}</text>
          </g>
        )
      })}
    </g>
  )
}
