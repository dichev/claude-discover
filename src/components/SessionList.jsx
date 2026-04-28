import React from 'react';
import { SOURCE_COLORS, SOURCE_LABELS } from '../utils/colors.js';
import { format } from 'date-fns';
import { fmtCompact } from '../utils/formatting.js';

export default function SessionList({ sessions, selectedId, onSelect, filter, onFilterChange }) {
  return (
    <div className="session-list">
      <div className="session-list-header">
        <input
          className="filter"
          placeholder="Filter by cwd, prompt, summary, id, model…"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
        />
        <div className="session-count">{sessions.length} sessions</div>
      </div>
      <div className="session-list-scroll">
        {sessions.length === 0 && (
          <div className="empty">No sessions on this day.</div>
        )}
        {sessions.map((s) => {
          const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheCreation;
          const label = s.summary || s.firstUserPrompt || s.sessionId;
          return (
            <div
              key={s.sessionId}
              className={`session-row ${selectedId === s.sessionId ? 'selected' : ''}`}
              onClick={() => onSelect(s.sessionId)}
              style={{ borderLeftColor: SOURCE_COLORS[s.source] || SOURCE_COLORS.other }}
              title={s.cwd || ''}
            >
              <div className="session-row-top">
                <span className="source-tag" style={{ color: SOURCE_COLORS[s.source] }}>
                  {SOURCE_LABELS[s.source] || s.source}
                </span>
                <span className="session-time">
                  <span className="session-time-meta">{s.messageCount} msgs · {fmtCompact(totalTokens)} tok · </span>
                  {format(s.lastActivityAt, 'HH:mm:ss')}
                </span>
              </div>
              <div className="session-label">{label}</div>
              {s.cwd && (
                <div className="session-row-meta">
                  <span className="cwd" title={s.cwd}>{shortCwd(s.cwd)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shortCwd(cwd) {
  if (!cwd) return '';
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}
