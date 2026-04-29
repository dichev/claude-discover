import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import TodayGantt from './components/TodayGantt.jsx';
import SessionList from './components/SessionList.jsx';
import SessionDetail from './components/SessionDetail.jsx';
import { startOfDay, endOfDay, format } from 'date-fns';

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [dayAnchor, setDayAnchor] = useState(() => +startOfDay(Date.now()));
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('');
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'agenticWorkflow.body', panelIds: ['list', 'detail'], storage: localStorage });
  const { defaultLayout: rootLayout, onLayoutChanged: onRootLayoutChanged } = useDefaultLayout({ id: 'agenticWorkflow.root', panelIds: ['gantt', 'body'], storage: localStorage });

  const dayRange = useMemo(() => {
    const start = dayAnchor;
    const end = +endOfDay(dayAnchor);
    return { start, end };
  }, [dayAnchor]);

  useEffect(() => {
    let cancelled = false;
    window.api.listSessions(format(dayAnchor, 'yyyy-MM-dd'))
      .then((s) => {
        if (!cancelled) setSessions(s || []);
      });
    const off = window.api.onSessionsUpdate((s) => { if (!cancelled) setSessions(s || []); });
    return () => { cancelled = true; off(); };
  }, [dayAnchor]);

  const dayItems = useMemo(() => ({ past: sessions }), [sessions]);

  const filteredSessions = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = dayItems.past;
    if (!q) return list;
    return list.filter((s) => {
      const blob = [
        s.name, s.aiTitle, s.summary, s.firstUserPrompt, s.cwd, s.sessionId, s.model, s.gitBranch
      ].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(q);
    });
  }, [dayItems.past, filter]);

  const selected = useMemo(
    () => sessions.find((s) => s.sessionId === selectedId) || null,
    [sessions, selectedId]
  );

  const shiftDay = useCallback((deltaDays) => {
    setDayAnchor((d) => +startOfDay(d + deltaDays * 86400_000 + 3600_000));
  }, []);

  return (
    <Group
      orientation="vertical"
      className="app"
      defaultLayout={rootLayout}
      onLayoutChanged={onRootLayoutChanged}
    >
      <Panel id="gantt" defaultSize={400} minSize={180} className="gantt-pane">
        <TodayGantt
          dayRange={dayRange}
          sessions={dayItems.past}
          onSelect={setSelectedId}
          selectedId={selectedId}
          onShiftDay={shiftDay}
          onResetToday={() => setDayAnchor(+startOfDay(Date.now()))}
          dayAnchor={dayAnchor}
        />
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
            sessions={filteredSessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            filter={filter}
            onFilterChange={setFilter}
          />
        </Panel>
        <Separator className="resize-handle resize-handle-v" />
        <Panel id="detail" minSize={30} className="body-pane">
          <SessionDetail meta={selected} date={format(dayAnchor, 'yyyy-MM-dd')} />
        </Panel>
        </Group>
      </Panel>
    </Group>
  );
}
