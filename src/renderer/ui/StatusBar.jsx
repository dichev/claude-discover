import React from 'react'
import StatusSwitch, { useSwitch } from './StatusSwitch'
import './StatusBar.css'

// Tooltip prose for each switch; StatusSwitch appends the live Activate/Deactivate button below it.
const proxyTooltip = <>
  <p>A local logging proxy can capture Claude Code's raw API traffic — system prompt, tool definitions, injected reminders and responses — shown in the session's Requests tab.</p>
  <p><b>Activate</b> launches the proxy and points Claude Code at it by setting in <code>settings.json</code>:</p>
  <pre>{`"env": {
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:41414",
  "ENABLE_TOOL_SEARCH": "true"
}`}</pre>
  <p><b>Deactivate</b> shuts it down and removes these settings. The proxy keeps running after this app closes.</p>
  <p>⚠ While <code>env.ANTHROPIC_BASE_URL</code> points at the proxy, Claude Code can't reach the API unless the proxy is running.</p>
</>

const retentionTooltip = <>
  <p>Claude Code deletes session transcripts older than <code>cleanupPeriodDays</code> (default 30), so this app can only show what hasn't been swept yet.</p>
  <p><b>Activate</b> raises it to 365 in <code>settings.json</code> so a year of history stays browsable (an already-higher value is left as is); <b>Deactivate</b> removes the setting, back to Claude Code's default of 30.</p>
</>

const statuslineTooltip = <>
  <p>This app ships a status line for Claude Code (<code>bin/claude/statusline.mjs</code>) showing context/token usage and rate limits.</p>
  <p><b>Activate</b> installs it as the <code>statusLine</code> command in <code>settings.json</code>; <b>Deactivate</b> removes it. If you already use a different status line, it's left untouched.</p>
</>

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
  // proxy { running, configured } · statusline { installed } · retention { days, raised }
  const proxy      = useSwitch({ name: 'proxy',      isOn: s => s?.running })
  const statusline = useSwitch({ name: 'statusline', isOn: s => s?.installed })
  const retention  = useSwitch({ name: 'retention',  isOn: s => s?.raised })
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
      <StatusSwitch service={retention} on={retentionRaised} warn={retention.status && !retentionRaised} tooltip={retentionTooltip}>
        Session logs retained: {retention.status ? humanizeDays(retention.status.days) : '…'}
      </StatusSwitch>
      <StatusSwitch service={proxy} on={proxyRunning} warn={proxyDown} className="statusbar-proxy" tooltip={proxyTooltip}>
        Capture proxy : {proxyRunning ? 'ON' : proxyDown ? 'DOWN' : 'off'}
      </StatusSwitch>
      <StatusSwitch service={statusline} on={statusline.status?.installed} tooltip={statuslineTooltip}>
        Status line : {statusline.status?.installed ? 'ON' : 'off'}
      </StatusSwitch>
      <span className="statusbar-claude-dir" title="Use the File menu (press Alt) to change directory.">
        Claude dir: <code>{claudeDir}</code>
      </span>
    </div>
  )
}
