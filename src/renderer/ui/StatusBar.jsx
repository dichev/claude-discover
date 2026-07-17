import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import tippy from 'tippy.js'
import './StatusBar.css'

// Activate/Deactivate button at the bottom of an interactive tooltip, wired to a useToggleService.
function ToggleButton({ service, on }) {
  return (
    <button className={`button-primary statusbar-tooltip-btn ${on ? 'statusbar-tooltip-btn-red' : 'statusbar-tooltip-btn-green'}`} disabled={service.busy || !service.status} onClick={service.toggle}>
      {service.busy ? '…' : on ? 'Deactivate' : 'Activate'}
    </button>
  )
}

// The tooltips are rendered as React (not title strings) so the Activate/Deactivate
// button at their bottom can be wired to live service state.
function ProxyTooltip({ proxy }) {
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
      <ToggleButton service={proxy} on={proxy.status?.running} />
    </div>
  )
}

function RetentionTooltip({ retention }) {
  return (
    <div className="statusbar-tooltip">
      <p>Claude Code deletes session transcripts older than <code>cleanupPeriodDays</code> (default 30), so this app can only show what hasn't been swept yet.</p>
      <p><b>Activate</b> raises it to 365 in <code>settings.json</code> so a year of history stays browsable (an already-higher value is left as is); <b>Deactivate</b> removes the setting, back to Claude Code's default of 30.</p>
      <ToggleButton service={retention} on={retention.status?.raised} />
    </div>
  )
}

function StatuslineTooltip({ statusline }) {
  return (
    <div className="statusbar-tooltip">
      <p>This app ships a status line for Claude Code (<code>bin/claude/statusline.mjs</code>) showing context/token usage and rate limits.</p>
      <p><b>Activate</b> installs it as the <code>statusLine</code> command in <code>settings.json</code>; <b>Deactivate</b> removes it. If you already use a different status line, it's left untouched.</p>
      <ToggleButton service={statusline} on={statusline.status?.installed} />
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

// Poll a main-process on/off service so the bar tracks external changes live (proxy starts/stops,
// settings.json edits), and expose its Activate/Deactivate toggle; `isOn` reads the on-flag from
// the service's status shape. Errors from a toggle come back as `status.error` and are alerted.
function useToggleService({ get, on, off, isOn }) {
  const [status, setStatus] = useState(null) // null until the first probe answers
  const [busy, setBusy]     = useState(false)
  useEffect(() => {
    let alive = true
    const check = () => get().then(s => alive && setStatus(s))
    check()
    const timer = setInterval(check, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  const toggle = async () => {
    setBusy(true)
    const next = await (isOn(status) ? off() : on())
    setStatus(next)
    setBusy(false)
    if (next.error) alert(next.error)
  }
  return { status, busy, toggle }
}

// Capture proxy: status is { running, configured } (see ProxyController); toggle = install & launch | exit & uninstall.
const useProxy = () => useToggleService({ get: window.api.getProxyStatus, on: window.api.startProxy, off: window.api.stopProxy, isOn: s => s?.running })

// Status line: status is { installed } (see StatuslineController); toggle = install | remove in settings.json.
const useStatusline = () => useToggleService({ get: window.api.getStatuslineStatus, on: window.api.activateStatusline, off: window.api.deactivateStatusline, isOn: s => s?.installed })

// Retention: status is { days, raised } (see RetentionController); toggle = raise cleanupPeriodDays to 1y | remove it.
const useRetention = () => useToggleService({ get: window.api.getRetentionStatus, on: window.api.activateRetention, off: window.api.deactivateRetention, isOn: s => s?.raised })

export default function StatusBar({ progress, sessionCount = 0 }) {
  const { claudeDir } = window.api.claudeSettings
  const proxy         = useProxy()
  const statusline    = useStatusline()
  const retention     = useRetention()
  const proxyRef      = useRef(null)
  const statuslineRef = useRef(null)
  const retentionRef  = useRef(null)
  const proxyTip      = useInteractiveTooltip(proxyRef)
  const statuslineTip = useInteractiveTooltip(statuslineRef)
  const retentionTip  = useInteractiveTooltip(retentionRef)
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
      <span className={`statusbar-group statusbar-seg ${retentionRaised ? 'statusbar-seg-on' : ''}`} ref={retentionRef}>
        <span className={`statusbar-msg ${retentionRaised ? 'statusbar-active' : 'statusbar-off'}`}>
          {retention.status && !retentionRaised && '⚠ '}Session logs retained: {retention.status ? humanizeDays(retention.status.days) : '…'}
        </span>
        {createPortal(<RetentionTooltip retention={retention} />, retentionTip)}
      </span>
      <span className={`statusbar-group statusbar-seg statusbar-proxy ${proxyRunning ? 'statusbar-seg-on' : ''}`} ref={proxyRef}>
        <span className={`statusbar-msg ${proxyRunning ? 'statusbar-active' : 'statusbar-off'}`}>
          {proxyDown && '⚠ '}Capture proxy : {proxyRunning ? 'ON' : proxyDown ? 'DOWN' : 'off'}
        </span>
        {createPortal(<ProxyTooltip proxy={proxy} />, proxyTip)}
      </span>
      <span className={`statusbar-group statusbar-seg ${statusline.status?.installed ? 'statusbar-seg-on' : ''}`} ref={statuslineRef}>
        <span className={`statusbar-msg ${statusline.status?.installed ? 'statusbar-active' : 'statusbar-off'}`}>
          Status line : {statusline.status?.installed ? 'ON' : 'off'}
        </span>
        {createPortal(<StatuslineTooltip statusline={statusline} />, statuslineTip)}
      </span>
      <span className="statusbar-claude-dir" title="Use the File menu (press Alt) to change directory.">
        Claude dir: <code>{claudeDir}</code>
      </span>
    </div>
  )
}
