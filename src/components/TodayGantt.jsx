import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { SOURCE_COLORS, SOURCE_LABELS } from '../utils/colors.js';

const LANE_HEIGHT = 22;
const LANE_GAP = 4;
const HEADER_HEIGHT = 28;
const MIN_BAR_PX = 4;
const GUTTER_WIDTH = 160;
const GROUP_GAP = 8;

function packLanes(items) {
  const lanes = [];
  const placed = items
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((item) => {
      let lane = lanes.findIndex((endTs) => endTs <= item.start);
      if (lane === -1) { lane = lanes.length; lanes.push(item.end); }
      else { lanes[lane] = item.end; }
      return { item, lane };
    });
  return { placed, laneCount: Math.max(1, lanes.length) };
}

function fmtDate(ts) { return new Date(ts).toLocaleDateString(); }

function shortCwd(cwd) {
  if (!cwd) return '(no cwd)';
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || cwd;
}

function HourTicks({ viewStart, viewEnd, width }) {
  const ticks = [];
  const startHour = new Date(viewStart);
  startHour.setMinutes(0, 0, 0);
  if (startHour.getTime() < viewStart) startHour.setHours(startHour.getHours() + 1);
  const span = viewEnd - viewStart;
  for (let t = startHour.getTime(); t <= viewEnd; t += 3600_000) {
    const x = ((t - viewStart) / span) * width;
    const d = new Date(t);
    const h = d.getHours();
    const label = h === 0 ? String(d.getDate()).padStart(2, '0') : String(h).padStart(2, '0');
    ticks.push({ x, label, major: h % 3 === 0 });
  }
  return (
    <g className="ticks">
      {ticks.map((tk, i) => (
        <g key={i} transform={`translate(${tk.x},0)`}>
          <line y1={0} y2={HEADER_HEIGHT} stroke={tk.major ? '#2a3140' : '#1a1f29'} />
          <line y1={HEADER_HEIGHT} y2="100%" stroke={tk.major ? '#161a22' : 'transparent'} />
          {tk.major && (
            <text x={4} y={14} fill="#7a8699" fontSize="11" fontFamily="ui-monospace,Menlo,monospace">{tk.label}</text>
          )}
        </g>
      ))}
    </g>
  );
}

export default function TodayGantt({
  dayRange, sessions, onSelect, selectedId, onShiftDay, onResetToday, dayAnchor
}) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(1200);
  const [view, setView] = useState({ start: dayRange.start, end: dayRange.end });

  useEffect(() => {
    setView({ start: dayRange.start, end: dayRange.end });
  }, [dayRange.start, dayRange.end]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(400, e.contentRect.width));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const { groups, totalHeight } = useMemo(() => {
    const byKey = new Map();
    for (const s of sessions) {
      const item = {
        id: s.sessionId,
        label: s.summary || s.firstUserPrompt || s.sessionId,
        start: s.startedAt,
        end: Math.max(s.lastActivityAt, s.startedAt + 60_000),
        source: s.source,
      };
      const key = s.cwd || '(no cwd)';
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(item);
    }
    const arr = [...byKey.entries()].map(([key, list]) => {
      const { placed, laneCount } = packLanes(list);
      const activity = list.reduce((sum, i) => sum + (i.end - i.start), 0);
      return { key, placed, laneCount, activity };
    });
    arr.sort((a, b) => b.activity - a.activity);
    let y = HEADER_HEIGHT;
    for (const g of arr) {
      g.yOffset = y;
      g.height = g.laneCount * (LANE_HEIGHT + LANE_GAP);
      y += g.height + GROUP_GAP;
    }
    return { groups: arr, totalHeight: Math.max(HEADER_HEIGHT + LANE_HEIGHT + 12, y + 4) };
  }, [sessions]);

  const chartWidth = Math.max(100, width - GUTTER_WIDTH);
  const span = view.end - view.start;
  const xFor = (ts) => GUTTER_WIDTH + ((ts - view.start) / span) * chartWidth;

  const onWheel = useCallback((e) => {
    if (!(e.shiftKey || e.ctrlKey) && e.deltaX === 0) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const xInCanvas = e.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, (xInCanvas - GUTTER_WIDTH) / chartWidth));
    if (e.shiftKey || e.ctrlKey) {
      const newSpan = Math.max(60_000, Math.min(7 * 86400_000, span * Math.exp(e.deltaY * 0.0015)));
      const center = view.start + ratio * span;
      const start = Math.max(dayRange.start, center - ratio * newSpan);
      const end = Math.min(dayRange.end, center + (1 - ratio) * newSpan);
      setView({ start, end });
    } else {
      const dt = (e.deltaX / chartWidth) * span;
      setView((v) => {
        const newStart = Math.max(dayRange.start, v.start + dt);
        const newEnd = Math.min(dayRange.end, v.end + dt);
        return newEnd - newStart < span ? v : { start: newStart, end: newEnd };
      });
    }
  }, [span, view.start, chartWidth, dayRange]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const handleMouseDown = useCallback((e) => {
    let startX = e.clientX;
    const handleMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const dt = (deltaX / chartWidth) * span;
      setView((v) => {
        const newStart = Math.max(dayRange.start, v.start - dt);
        const newEnd = Math.min(dayRange.end, v.end - dt);
        return newEnd - newStart < span ? v : { start: newStart, end: newEnd };
      });
      startX = moveEvent.clientX;
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [chartWidth, span, dayRange]);

  const now = Date.now();
  const showNow = now >= view.start && now <= view.end;
  const isToday = new Date(dayAnchor).setHours(0,0,0,0) === new Date().setHours(0,0,0,0);

  return (
    <div className="gantt-wrap">
      <div className="gantt-toolbar">
        <div className="gantt-title">
          <span className="title-strong">{isToday ? 'Today' : fmtDate(dayAnchor)}</span>
          <span className="title-faint">{fmtDate(dayAnchor)}</span>
        </div>
        <div className="gantt-controls">
          <button onClick={() => onShiftDay(-1)}>← Prev</button>
          <button onClick={onResetToday}>Today</button>
          <button onClick={() => onShiftDay(1)}>Next →</button>
        </div>
      </div>
      <div className="gantt-legend-meta">
        <div className="gantt-meta">
          <span>{sessions.length} sessions · {groups.length} workdirs</span>
          <span className="gantt-hint">shift/ctrl+scroll to zoom, drag to pan</span>
        </div>
        <div className="gantt-legend">
          {['scheduled','cli','desktop','sdk','other'].map((k) => (
            <span key={k} className="legend-chip">
              <span className="swatch" style={{ background: SOURCE_COLORS[k] }} />
              {SOURCE_LABELS[k]}
            </span>
          ))}
        </div>
      </div>
      <div className="gantt-canvas" ref={containerRef} onMouseDown={handleMouseDown}>
        <svg width={width} height={totalHeight}>
          <rect x={0} y={0} width={GUTTER_WIDTH} height={totalHeight} fill="#0e1118" />
          <line x1={GUTTER_WIDTH} x2={GUTTER_WIDTH} y1={0} y2={totalHeight} stroke="#232936" />
          <g transform={`translate(${GUTTER_WIDTH},0)`}>
            <HourTicks viewStart={view.start} viewEnd={view.end} width={chartWidth} />
          </g>
          {groups.map((g, gi) => (
            <g key={g.key}>
              {gi > 0 && (
                <line
                  x1={0} x2={width}
                  y1={g.yOffset - GROUP_GAP / 2}
                  y2={g.yOffset - GROUP_GAP / 2}
                  stroke="#1B212C"
                />
              )}
              <text x={8} y={g.yOffset + 14} fill="#cbd1dc" fontSize="11"
                    fontFamily="ui-sans-serif,system-ui,sans-serif">
                <title>{g.key}</title>
                {shortCwd(g.key)}
              </text>
              {g.placed.map(({ item, lane }) => {
                const rawX1 = xFor(item.start);
                const rawX2 = xFor(item.end);
                if (rawX2 < GUTTER_WIDTH || rawX1 > width) return null;
                const x1 = Math.max(GUTTER_WIDTH, rawX1);
                const w = Math.max(MIN_BAR_PX, Math.min(width, rawX2) - x1);
                const y = g.yOffset + lane * (LANE_HEIGHT + LANE_GAP);
                const color = SOURCE_COLORS[item.source] || SOURCE_COLORS.other;
                const isSelected = item.id === selectedId;
                return (
                  <g key={item.id} className={`bar ${isSelected ? 'selected' : ''}`}
                     onClick={() => onSelect(item.id)} style={{ cursor: 'pointer' }}>
                    <rect x={x1} y={y} width={w} height={LANE_HEIGHT} rx={3}
                          fill={color} stroke={isSelected ? '#fff' : 'transparent'}
                          strokeWidth={isSelected ? 1.5 : 1} opacity={0.92} />
                    {w > 30 && (
                      <text x={x1 + 6} y={y + LANE_HEIGHT / 2 + 4} fill="#0b0d12"
                            fontSize="11" fontFamily="ui-sans-serif,system-ui,sans-serif"
                            style={{ pointerEvents: 'none' }}
                            clipPath={`inset(0 ${Math.max(0, width - (x1 + w - 4))}px 0 0)`}>
                        {item.label.slice(0, Math.max(2, Math.floor(w / 6)))}
                      </text>
                    )}
                    <title>{`${SOURCE_LABELS[item.source] || item.source} · ${item.label}\n${g.key}\n${new Date(item.start).toLocaleString()} → ${new Date(item.end).toLocaleString()}`}</title>
                  </g>
                );
              })}
            </g>
          ))}
          {showNow && (
            <g className="now-line">
              <line x1={xFor(now)} x2={xFor(now)} y1={HEADER_HEIGHT - 8} y2={totalHeight}
                    stroke="#ef4444" strokeWidth="1.5" />
              <text x={xFor(now) + 4} y={HEADER_HEIGHT - 2} fill="#ef4444" fontSize="11">now</text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
