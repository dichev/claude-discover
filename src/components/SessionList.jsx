import React, { useEffect, useRef } from 'react';
import { SOURCE_COLORS, SOURCE_LABELS } from '../utils/colors.js';
import { format } from 'date-fns';
import { fmtCompact } from '../utils/formatting.js';

export default function SessionList({ sessions, selectedId, onSelect, filter, onFilterChange }) {
  const selectedRef = useRef(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <div className="session-list">
      <div className="session-list-header">
        <input
          className="filter"
          placeholder="Filter sessions…"
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
          const fallback = s.summary || s.firstUserPrompt || s.sessionId;
          const label = s.name || fallback;
          const subLabel = s.name && fallback !== s.name ? fallback : null;
          return (
            <div
              key={s.sessionId}
              ref={selectedId === s.sessionId ? selectedRef : null}
              className={`session-row ${selectedId === s.sessionId ? 'selected' : ''}`}
              onClick={() => onSelect(s.sessionId)}
              style={{ borderLeftColor: SOURCE_COLORS[s.source] || SOURCE_COLORS.other }}
              title={s.cwd || ''}
            >
              <div className="session-row-top">
                {(s.cwd || s.model) && (
                  <div className="session-row-meta">
                    {s.cwd && <span className="cwd" title={s.cwd}>{shortCwd(s.cwd)}</span>}
                    {/*{s.model && <span className="model-tag">{s.model}</span>}*/}
                  </div>
                )}
                <span className="session-time">
                  {/*<span className="session-time-meta">{s.messageCount} msgs · {fmtCompact(totalTokens)} tok · </span>*/}
                  {format(s.lastActivityAt, 'HH:mm:ss')}
                </span>
              </div>
              <div className="session-label">
                {s.name && <span className="session-name">{s.name}</span>}
                {subLabel || (!s.name && label)}
              </div>
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
