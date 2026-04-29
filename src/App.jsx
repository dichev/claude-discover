import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import TodayGantt from './components/TodayGantt.jsx';
import SessionList from './components/SessionList.jsx';
import SessionDetail from './components/SessionDetail.jsx';
import { startOfDay, endOfDay } from 'date-fns';

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [dayAnchor, setDayAnchor] = useState(() => +startOfDay(Date.now()));
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('');
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'agenticWorkflow.body', panelIds: ['list', 'detail'], storage: localStorage });
  const { defaultLayout: rootLayout, onLayoutChanged: onRootLayoutChanged } = useDefaultLayout({ id: 'agenticWorkflow.root', panelIds: ['gantt', 'body'], storage: localStorage });

  useEffect(() => {
    let off;
    (async () => {
      const initial = await window.api.listSessions();
      setSessions(initial || []);
      off = window.api.onSessionsUpdate((s) => setSessions(s || []));
    })();
    return () => { if (off) off(); };
  }, []);

  const dayRange = useMemo(() => {
    const start = dayAnchor;
    const end = +endOfDay(dayAnchor);
    return { start, end };
  }, [dayAnchor]);

  const dayItems = useMemo(() => {
    const { start, end } = dayRange;
    const past = sessions.filter((s) => s.lastActivityAt >= start && s.startedAt <= end);
    return { past };
  }, [sessions, dayRange]);

  const filteredSessions = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = dayItems.past;
    if (!q) return list;
    return list.filter((s) => {
      const blob = [
        s.summary, s.firstUserPrompt, s.cwd, s.sessionId, s.model, s.gitBranch
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
          <SessionDetail meta={selected} />
        </Panel>
        </Group>
      </Panel>
    </Group>
  );
}
