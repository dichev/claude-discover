import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import tippy from 'tippy.js'
import './StatusBar.css'

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

// Rendered as React (not a title string like the others) so the Activate/Deactivate
// button at its bottom can be wired to live proxy state.
function ProxyTooltip({ proxy }) {
  const running = proxy.status?.running
  return (
    <div className="statusbar-tooltip">
      <p>A local logging proxy can capture Claude Code's raw API traffic — system prompt, tool definitions, injected reminders and responses — shown in the session's Requests tab.</p>
      <p><b>Activate</b> launches the proxy and points Claude Code at it by setting in <code>settings.json</code>:</p>
      <pre>{`"env": {
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:41414",
  "ENABLE_TOOL_SEARCH": "true"
}`}</pre>
      <p><b>Deactivate</b> shuts it down and removes these settings. The proxy keeps running after this app closes.</p>
      <p>⚠ While <code>env.ANTHROPIC_BASE_URL</code> points at the proxy, Claude Code can't reach the API unless the proxy is running.</p>
      <button className={`button-primary statusbar-tooltip-btn ${running ? 'statusbar-tooltip-btn-red' : 'statusbar-tooltip-btn-green'}`} disabled={proxy.busy || !proxy.status} onClick={proxy.toggle}>
        {proxy.busy ? '…' : running ? 'Deactivate' : 'Activate'}
      </button>
    </div>
  )
}

// Attach an interactive tippy (stays open while the cursor is over it) with a React-rendered
// body, portalled into the tippy container so the content stays live. The global delegate in
// main.jsx only targets [title] elements, so it leaves this one alone.
function useInteractiveTooltip(ref) {
  const [container] = useState(() => document.createElement('div'))
  useEffect(() => {
    const tip = tippy(ref.current, {
      content: container,
      interactive: true,
      delay: [0, 0],
      appendTo: () => document.body,
    })
    return () => tip.destroy()
  }, [])
  return container
}

const ONE_YEAR_DAYS = 365

// Humanize a day count for the status bar: years once past a year, otherwise raw days.
function humanizeDays(days) {
  if (days < ONE_YEAR_DAYS) return `${days}d`
  const years = days / ONE_YEAR_DAYS
  return `${Number.isInteger(years) ? years : years.toFixed(1)}y`
}

// Poll the capture proxy's ping route (via main) so the bar tracks starts/stops live,
// and expose the Start/Stop toggle (install & launch | exit & uninstall, see ProxyController).
function useProxy() {
  const [status, setStatus] = useState(null) // { running, configured }; null until the first probe answers
  const [busy, setBusy]     = useState(false)
  useEffect(() => {
    let alive = true
    const check = () => window.api.getProxyStatus().then(s => alive && setStatus(s))
    check()
    const timer = setInterval(check, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  const toggle = async () => {
    setBusy(true)
    const next = await (status?.running ? window.api.stopProxy() : window.api.startProxy())
    setStatus(next)
    setBusy(false)
    if (next.error) alert(next.error)
  }
  return { status, busy, toggle }
}

export default function StatusBar({ progress, sessionCount = 0 }) {
  const { claudeDir, statuslineInstalled } = window.api.claudeSettings
  const proxy    = useProxy()
  const proxyRef = useRef(null)
  const proxyTip = useInteractiveTooltip(proxyRef)
  const proxyRunning = proxy.status?.running
  const proxyDown = proxy.status?.configured && proxyRunning === false // Claude Code is pointed at a dead proxy — it can't reach the API
  const retentionDays = window.api.claudeSettings.cleanupPeriodDays ?? 30 // Claude Code's default when unset
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
        Claude dir: <code>{claudeDir}</code>
      </span>
      <span className="statusbar-group" title={RETENTION_TOOLTIP}>
        <span className={`statusbar-msg ${shortRetention ? 'statusbar-off' : ''}`}>
          {shortRetention && '⚠ '}Session logs retained: {humanizeDays(retentionDays)}
        </span>
      </span>
      <span className={`statusbar-group statusbar-proxy ${proxyRunning ? 'statusbar-proxy-on' : ''}`} ref={proxyRef}>
        <span className={`statusbar-msg ${proxyRunning ? 'statusbar-active' : 'statusbar-off'}`}>
          {proxyDown && '⚠ '}Capture proxy : {proxyRunning ? 'ON' : proxyDown ? 'DOWN' : 'off'}
        </span>
        {createPortal(<ProxyTooltip proxy={proxy} />, proxyTip)}
      </span>
      <span className="statusbar-group" title={STATUSLINE_TOOLTIP}>
        <span className={`statusbar-msg ${statuslineInstalled ? 'statusbar-on' : 'statusbar-off'}`}>
          Status line : {statuslineInstalled ? 'ON' : 'off'}
        </span>
      </span>
    </div>
  )
}
