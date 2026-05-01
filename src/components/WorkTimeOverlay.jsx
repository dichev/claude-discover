import React, { useEffect, useState } from 'react'
import './WorkTimeOverlay.css'

const SNAP_MIN = 5

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
const fmtHM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const parseHM = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }

export default function WorkTimeOverlay({
  dayStart, viewStart, viewEnd, chartLeft, chartWidth, totalHeight, headerHeight, containerRef,
}) {
  const [workTime, setWorkTime] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    window.api.getWorkHours().then(({ work_hours: w }) => setWorkTime({ startMin: parseHM(w.start), endMin: parseHM(w.end) }))
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
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
      <rect className="work-offhours-shade" x={chartLeft} y={0} width={Math.max(0, shadeL - chartLeft)} height={totalHeight} />
      <rect className="work-offhours-shade" x={shadeR} y={0} width={Math.max(0, chartRight - shadeR)} height={totalHeight} />
      {renderHandle('start', xStart, workTime.startMin)}
      {renderHandle('end', xEnd, workTime.endMin)}
      {showNow && (
        <g className="now-line">
          <line x1={xForTs(now)} x2={xForTs(now)} y1={0} y2={totalHeight} />
          <text x={xForTs(now) + 4} y={headerHeight - 2}>now</text>
        </g>
      )}
    </g>
  )
}
