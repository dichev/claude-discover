import React from 'react'
import './StatusBar.css'

const HOOK_TOOLTIP = `
  <div class="statusbar-tooltip">
    <p>Claude Code doesn't save your CLAUDE.md instructions in its session logs, so this app can't show them as a context.</p>
    <p>You can install a claude hook that logs that context alongside each session in a separate file:</p>
    <ul>
      <li><code>&lt;session&gt;.jsonl</code> — the transcript</li>
      <li><code>&lt;session&gt;.context.ndjson</code> — the context snapshot</li>
    </ul>
    <p>Then your CLAUDE.md content shows up in the Conversation and JSONL tabs.</p>
    <p>Run <code>npm run setup-hook</code> to install.</p>
  </div>
`

export default function StatusBar({ progress, sessionCount = 0 }) {
  const installed = window.api.hookInstalled
  const scanning = progress?.scanning && progress.total > 0
  const finished = progress && !progress.scanning // keep "Loaded N" visible after the scan completes
  const pct = scanning ? (progress.done / progress.total) * 100 : 0

  return (
    <div className="statusbar">
      {(scanning || finished) && (
        <span className="statusbar-loading">
          <span className="statusbar-loading-text">
            {scanning ? 'Loading' : 'Loaded'} <span className="statusbar-loading-num">{sessionCount}</span> sessions{scanning ? '…' : ''}
          </span>
          {scanning && (
            <span className="progress-bar">
              <span className="progress-bar-fill" style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>
      )}
      <span className="statusbar-claude-dir" title="Use the File menu (press Alt) to change directory.">
        Claude dir: <code>{window.api.claudeDir}</code>
      </span>
      <span className="statusbar-group" title={HOOK_TOOLTIP}>
        <span className={`statusbar-msg ${installed ? 'statusbar-on' : 'statusbar-off'}`}>
          Capture context hook : {installed ? 'ON' : 'off'}
        </span>
      </span>
    </div>
  )
}
