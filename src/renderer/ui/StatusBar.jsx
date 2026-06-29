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

const STATUSLINE_TOOLTIP = `
  <div class="statusbar-tooltip">
    <p>This app ships a status line for Claude Code (<code>bin/statusline.mjs</code>) showing context/token usage and rate limits.</p>
    <p>Run <code>npm run setup-hook</code> to install it. If you already use a different status line, it's left untouched.</p>
  </div>
`

const RETENTION_TOOLTIP = `
  <div class="statusbar-tooltip">
    <p>Claude Code deletes session transcripts older than <code>cleanupPeriodDays</code> (default 30), so this app can only show what hasn't been swept yet.</p>
    <p>To keep more history browsable, set a larger value in <code>settings.json</code>, e.g. to keep them for 1y set:</p>
    <ul><li><code>"cleanupPeriodDays": 365</code></li></ul>
  </div>
`

const ONE_YEAR_DAYS = 365

// Humanize a day count for the status bar: years once past a year, otherwise raw days.
function humanizeDays(days) {
  if (days < ONE_YEAR_DAYS) return `${days}d`
  const years = days / ONE_YEAR_DAYS
  return `${Number.isInteger(years) ? years : years.toFixed(1)}y`
}

export default function StatusBar({ progress, sessionCount = 0 }) {
  const installed = window.api.hookInstalled
  const statuslineInstalled = window.api.statuslineInstalled
  const retentionDays = window.api.cleanupPeriodDays ?? 30 // Claude Code's default when unset
  const shortRetention = retentionDays < ONE_YEAR_DAYS
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
      <span className="statusbar-group" title={RETENTION_TOOLTIP}>
        <span className={`statusbar-msg ${shortRetention ? 'statusbar-off' : ''}`}>
          {shortRetention && '⚠ '}Session logs retained: {humanizeDays(retentionDays)}
        </span>
      </span>
      <span className="statusbar-group" title={HOOK_TOOLTIP}>
        <span className={`statusbar-msg ${installed ? 'statusbar-on' : 'statusbar-off'}`}>
          Capture context hook : {installed ? 'ON' : 'off'}
        </span>
      </span>
      <span className="statusbar-group" title={STATUSLINE_TOOLTIP}>
        <span className={`statusbar-msg ${statuslineInstalled ? 'statusbar-on' : 'statusbar-off'}`}>
          Status line : {statuslineInstalled ? 'ON' : 'off'}
        </span>
      </span>
    </div>
  )
}
