import React, { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { fmtDuration, fmtBytes, fmtNum } from '../utils/formatting.js';
import ConversationView from './ConversationView.jsx';

export default function SessionDetail({ meta }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const offsetRef = useRef(0);
  const sidRef = useRef(null);

  const sessionId = meta?.sessionId;
  const fileSize = meta?.fileSize;

  useEffect(() => {
    if (!sessionId) {
      setItems(null);
      offsetRef.current = 0;
      sidRef.current = null;
      return;
    }
    const sidChanged = sidRef.current !== sessionId;
    if (sidChanged) {
      offsetRef.current = 0;
      sidRef.current = sessionId;
      setItems(null);
      setLoading(true);
    } else if (fileSize <= offsetRef.current) {
      return;
    }
    let cancelled = false;
    const fromOffset = offsetRef.current;
    window.api.readSession(sessionId, fromOffset).then((res) => {
      if (cancelled || !res) return;
      offsetRef.current = res.nextOffset;
      setItems((prev) => fromOffset === 0 ? res.items : prev.concat(res.items));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [sessionId, fileSize]);

  if (!meta) {
    return <div className="session-detail empty"><div>Select a session to inspect.</div></div>;
  }

  const totalTokens = meta.tokens.input + meta.tokens.output + meta.tokens.cacheRead + meta.tokens.cacheCreation;
  const duration = meta.lastActivityAt - meta.startedAt;

  return (
    <div className="session-detail">
      <div className="detail-body">
        <div className="detail-conversation">
          {loading && <div className="empty">Loading conversation…</div>}
          {items && <ConversationView items={items} />}
        </div>
        <div className="detail-meta">
          <Field label="Session ID" value={meta.sessionId} mono />
          <Field label="cwd" value={meta.cwd || '—'} mono />
          <Field label="Git branch" value={meta.gitBranch || '—'} mono />
          <Field label="Model" value={meta.model || '—'} mono />
          <Field label="CLI version" value={meta.version || '—'} mono />
          <Field label="Started" value={format(meta.startedAt, 'PPpp')} />
          <Field label="Last activity" value={format(meta.lastActivityAt, 'PPpp')} />
          <Field label="Duration" value={fmtDuration(duration)} />
          <Field label="Messages" value={fmtNum(meta.messageCount)} />
          <Field label="File size" value={fmtBytes(meta.fileSize)} />
          <Field label="Tokens (total)" value={fmtNum(totalTokens)} />
          <Field
            label="Tokens (in/out/cache r/cache c)"
            value={`${fmtNum(meta.tokens.input)} / ${fmtNum(meta.tokens.output)} / ${fmtNum(meta.tokens.cacheRead)} / ${fmtNum(meta.tokens.cacheCreation)}`}
          />
          <Field label="JSONL path" value={meta.filePath} mono full />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono, full }) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <div className="field-label">{label}</div>
      <div className={`field-value ${mono ? 'mono' : ''}`}>{value}</div>
    </div>
  );
}
