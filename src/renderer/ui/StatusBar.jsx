import React from 'react'
import StatusSwitch, { useSwitch } from './StatusSwitch'
import './StatusBar.css'

// Tooltip prose for each switch; StatusSwitch appends the live Activate/Deactivate button below it.
const proxyTooltip = <p>Captures Claude Code's raw API traffic - system prompt, tool definitions, injected reminders, responses.<p></p>Applies only to newly started Claude Code sessions.</p>
const proxyChanges = <>
  <pre>{`"env": {
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:41414",
  "ENABLE_TOOL_SEARCH": "true"
},
"hooks": {
  "SessionStart": ["…/bin/claude/hooks.mjs"]
}`}</pre>
  <p>Note: <code>/remote-control</code> is disabled while proxy is active.</p>
</>

const retentionTooltip = <p>Claude Code deletes transcripts older than <code>cleanupPeriodDays</code> (default 30) - this app can only show what's left. Raise it to keep a year of history browsable.</p>
const retentionChanges = <pre>{`"cleanupPeriodDays": 365`}</pre>

const statuslineTooltip = <p>This app ships a status line for Claude Code showing context/token usage and rate limits.</p>
const statuslineChanges = <pre>{`"statusLine": {
  "type": "command",
  "command": "node …/bin/claude/statusline.mjs"
}`}</pre>

const claudeDirTooltip = <>
  <p>The folder this app reads everything from - your Claude Code sessions and settings (usually <code>~/.claude</code>).</p>
  <p>Previous directories are listed in the File menu (press Alt).</p>
</>
const claudeDirChanges = <pre>{`"claudeDir": "…the chosen folder"`}</pre>

const ONE_YEAR_DAYS = 365

// Humanize a day count for the status bar: years once past a year, otherwise raw days.
function humanizeDays(days) {
  if (days < ONE_YEAR_DAYS) return `${days}d`
  const years = days / ONE_YEAR_DAYS
  return `${Number.isInteger(years) ? years : years.toFixed(1)}y`
}

export default function StatusBar({ progress, sessionCount = 0 }) {
  const { claudeDir } = window.api.claudeSettings
  // Status shapes come from the matching *Switch in src/main/services/switchers/:
  // proxy { running, configured } · statusline { installed } · retention { days, raised } · claudedir { dir }
  const proxy      = useSwitch({ name: 'proxy',      isOn: s => s?.running })
  const statusline = useSwitch({ name: 'statusline', isOn: s => s?.installed })
  const retention  = useSwitch({ name: 'retention',  isOn: s => s?.raised })
  const claudedir  = useSwitch({ name: 'claudedir' }) // action-style: its button always activates (opens the folder picker)
  const proxyRunning = proxy.status?.running
  const proxyDown = proxy.status?.configured && proxyRunning === false // Claude Code is pointed at a dead proxy — it can't reach the API
  const retentionRaised = retention.status?.raised
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
      <StatusSwitch service={retention} on={retentionRaised} warn={!!(retention.status && !retentionRaised)} tooltip={retentionTooltip} changes={retentionChanges}>
        Session logs <span className="statusbar-state">{retention.status ? humanizeDays(retention.status.days) : '…'}</span>
      </StatusSwitch>
      <StatusSwitch service={proxy} on={proxyRunning} warn={!!proxyDown} tooltip={proxyTooltip} changes={proxyChanges}>
        Capture proxy : <span className="statusbar-state">{proxyRunning ? 'ON' : proxyDown ? 'DOWN' : 'off'}</span>
      </StatusSwitch>
      <StatusSwitch service={statusline} on={statusline.status?.installed} tooltip={statuslineTooltip} changes={statuslineChanges}>
        Status line : <span className="statusbar-state">{statusline.status?.installed ? 'ON' : 'off'}</span>
      </StatusSwitch>
      <StatusSwitch service={claudedir} button="Change directory" className="statusbar-claude-dir" tooltip={claudeDirTooltip} changes={claudeDirChanges} changesTitle="Changes in ~/.claude-discover/config.json">
        Claude dir: <code>{claudeDir}</code>
      </StatusSwitch>
    </div>
  )
}
