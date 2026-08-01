import { useMemo } from 'react'

const BIN_HEIGHT_PX = 4
const BIN_WIDTH_MINUTES = 5
const BIN_WIDTH_MS = BIN_WIDTH_MINUTES * 60_000

// $ per bin → color tier
const STOPS = [
  [2,        'rgb(128 136 147 / 0.25)'], // light
  [5,        'rgb(245 158  11 / 0.70)'], // heavy
  [10,       'rgb(239  68  68 / 0.95)'], // very expensive
  [Infinity, 'rgb(185  28  28 / 1.00)'], // outlier
]

export default function HeatStrip({ sessions, viewStart, viewEnd, width, gutter }) {
  const chartWidth = width - gutter
  // Snap to absolute 5-min wall-clock slots so a slice keeps the same color at any zoom.
  const slotStart = Math.floor(viewStart / BIN_WIDTH_MS) * BIN_WIDTH_MS
  const binCount  = Math.ceil((viewEnd - slotStart) / BIN_WIDTH_MS)
  const binW      = (BIN_WIDTH_MS / (viewEnd - viewStart)) * chartWidth
  const x0        = ((slotStart - viewStart) / (viewEnd - viewStart)) * chartWidth

  const bins = useMemo(() => {
    const arr = new Float64Array(binCount)
    for (const s of sessions) {
      for (const { start, end, cost } of s.costSamples ?? []) {
        const turnEnd = Math.max(end, start + 1)
        const ratePerMs = cost / (turnEnd - start)
        const b0 = Math.max(0, Math.floor((start - slotStart) / BIN_WIDTH_MS))
        const b1 = Math.min(binCount - 1, Math.floor((turnEnd - slotStart) / BIN_WIDTH_MS))
        for (let b = b0; b <= b1; b++) {
          const bs = slotStart + b * BIN_WIDTH_MS
          arr[b] += ratePerMs * (Math.min(turnEnd, bs + BIN_WIDTH_MS) - Math.max(start, bs))
        }
      }
    }
    return arr
  }, [sessions, slotStart, binCount])

  return (
    <svg width={width} height={BIN_HEIGHT_PX} className="heat-strip">
      <rect x={0} y={0} width={gutter} height={BIN_HEIGHT_PX} className="gantt-gutter" />
      <g transform={`translate(${gutter},0)`}>
        {Array.from(bins, (cost, i) => {
          if (cost <= 0) return null
          const fill = STOPS.find(([max]) => cost < max)[1]
          return (
            <rect key={i} x={x0 + i * binW} y={0} width={binW + 0.6} height={BIN_HEIGHT_PX} fill={fill}>
              <title>{`$${cost.toFixed(2)} in ${BIN_WIDTH_MINUTES}m`}</title>
            </rect>
          )
        })}
      </g>
    </svg>
  )
}
