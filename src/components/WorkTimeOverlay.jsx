import React, { useEffect, useState } from 'react'
import './WorkTimeOverlay.css'

const SNAP_MIN = 5
const COLOR = '#cbd1dc'
const SHADE = 'url(#work-offhours-stripes)'

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
const fmtHM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const parseHM = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }

export default function WorkTimeOverlay({
  dayStart, viewStart, viewEnd, chartLeft, chartWidth, totalHeight, containerRef,
}) {
  const [workTime, setWorkTime] = useState(null)
  const [dragging, setDragging] = useState(null)

  useEffect(() => {
    window.api.getWorkHours().then(({ work_hours: w }) => setWorkTime({ startMin: parseHM(w.start), endMin: parseHM(w.end) }))
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
      <g onMouseDown={startDrag(which)} style={{ cursor: 'ew-resize' }}>
        <rect x={x - 7} y={0} width={14} height={totalHeight} fill="transparent" />
        <line x1={x} x2={x} y1={0} y2={totalHeight} stroke={COLOR} strokeWidth={2} />
        <rect x={x - 4} y={6} width={8} height={16} rx={2} fill={COLOR} />
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

  return (
    <g>
      <defs>
        <pattern id="work-offhours-stripes" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={8} stroke="#ef4444" strokeWidth={1.5} opacity={0.45} />
        </pattern>
      </defs>
      <rect x={chartLeft} y={0} width={Math.max(0, shadeL - chartLeft)} height={totalHeight} fill={SHADE} pointerEvents="none" />
      <rect x={shadeR} y={0} width={Math.max(0, chartRight - shadeR)} height={totalHeight} fill={SHADE} pointerEvents="none" />
      {renderHandle('start', xStart, workTime.startMin)}
      {renderHandle('end', xEnd, workTime.endMin)}
    </g>
  )
}
