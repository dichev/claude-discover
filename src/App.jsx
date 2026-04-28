import React, { useEffect, useMemo, useState, useCallback } from 'react';
import TodayGantt from './components/TodayGantt.jsx';
import SessionList from './components/SessionList.jsx';
import SessionDetail from './components/SessionDetail.jsx';
import { startOfDay, endOfDay } from 'date-fns';

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [dayAnchor, setDayAnchor] = useState(() => +startOfDay(Date.now()));
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let off;
    (async () => {
      const initial = await window.discover.listSessions();
      setSessions(initial || []);
      off = window.discover.onSessionsUpdate((s) => setSessions(s || []));
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
    <div className="app">
      <TodayGantt
        dayRange={dayRange}
        sessions={dayItems.past}
        onSelect={setSelectedId}
        selectedId={selectedId}
        onShiftDay={shiftDay}
        onResetToday={() => setDayAnchor(+startOfDay(Date.now()))}
        dayAnchor={dayAnchor}
      />
      <div className="body">
        <SessionList
          sessions={filteredSessions}
          selectedId={selectedId}
          onSelect={setSelectedId}
          filter={filter}
          onFilterChange={setFilter}
        />
        <SessionDetail meta={selected} />
      </div>
    </div>
  );
}
