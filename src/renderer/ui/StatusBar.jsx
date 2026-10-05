import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import { format, isToday } from 'date-fns'
import StatusSwitch, { useSwitch } from './StatusSwitch'
import { tone } from '../utils/formatting'
import { THRESHOLDS } from '../utils/thresholds'
import './StatusBar.css'

// Tooltip prose for each switch; StatusSwitch appends the live Activate/Deactivate button below it.
const proxyTooltip = <>
  <p>Captures Claude Code's raw API traffic - system prompt, tool definitions, injected reminders, responses.</p>
  <p>Applies to running Claude Code sessions too.</p>
</>
const proxyChanges = <>
  <pre>{`"env": {
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:41414",
  "ENABLE_TOOL_SEARCH": "true"
}`}</pre>
  <p>Also registers the proxy as a login service so it survives restarts.</p>
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

const updateTooltip = ({ current, latest }) => <>
  <p>A new version is available: <b>v{current} → v{latest}</b></p>
  <p>The app will restart to install it - this takes about a minute.</p>
</>

const npxTooltip = <>
  <p>This copy runs from the npx cache, which npm clears from time to time.</p>
  <p>Install it globally to keep it, with in-app updates and settings that stay active after closing.</p>
  <p>The app will restart from the global install - this takes about a minute.</p>
</>

// Server-supplied labels (model and product names) go into an HTML tooltip
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)

// "4:30 PM" today, "Wed 1:00 PM" later
const fmtTime = ts => format(ts, isToday(ts) ? 'h:mm a' : 'EEE h:mm a')

const tipBar = (pct, pctTone) => `<span class="progress-bar tone-${pctTone}"><span class="progress-bar-fill" style="width: ${Math.min(pct, 100)}%"></span></span>`

// One tooltip row per limit: label, bar, used %, and when it resets
const limitRow = (label, w) => {
  const pct     = Math.floor(w.utilization)
  const pctTone = tone(pct, THRESHOLDS.limit)
  const resets  = w.resetsAt > Date.now() ? `resets ${isToday(w.resetsAt) ? 'at ' : ''}${fmtTime(w.resetsAt)}` : ''
  return `<span>${label}</span>${tipBar(pct, pctTone)}<span class="tip-pct ${pctTone}">${pct}%</span><span class="tip-faint">${resets}</span>`
}

// `limit` is missing while loading or when usage isn't available; the bar then stays empty
function UsageBar({ label, limit, placeholder }) {
  const pct     = limit ? Math.floor(limit.utilization) : null
  const pctTone = tone(pct, THRESHOLDS.limit)
  return (
    <span className={`statusbar-group statusbar-limit ${pctTone}`}>
      <span>{label}</span>
      <span className={`progress-bar tone-${pctTone}`}><span className="progress-bar-fill" style={{ width: `${pct ?? 0}%` }} /></span>
      <span className="statusbar-num">{pct != null ? `${pct}%` : placeholder}</span>
    </span>
  )
}

// Everything /usage reported, as the bars' HTML tooltip
function usageTip({ at, plan, fiveHour, sevenDay, models, sources, extra }) {
  const money     = n => new Intl.NumberFormat(undefined, { style: 'currency', currency: extra.currency || 'USD' }).format(n / 10 ** extra.decimals)
  const userOff   = extra && !extra.on && !extra.reason
  const extraPct  = extra?.limit ? Math.floor((extra.used ?? 0) / extra.limit * 100) : 0
  const extraRow  = extra && [
    '<span class="tip-sep"></span><span>Extra usage</span>',
    userOff ? '<span></span>' : tipBar(extraPct, tone(extraPct, THRESHOLDS.limit)),
    `<span class="tip-pct">${userOff ? 'off' : money(extra.used ?? 0)}</span>`,
    `<span class="tip-faint">${userOff ? '' : extra.limit != null ? `of ${money(extra.limit)} this month` : 'this month'}</span>`,
  ].join('')
  const tip = [
    `<div class="tip-head"><b>Claude Usage${plan ? ` (${esc(plan[0].toUpperCase() + plan.slice(1))})` : ''}</b></div>`,
    '<div class="tip-limits">',
    fiveHour && limitRow('Daily', fiveHour),
    sevenDay && limitRow('Weekly', sevenDay),
    ...models.map(m => limitRow(`Weekly (${esc(m.name)})`, m)),
    extraRow,
    '</div>',
    `<div class="tip-foot">`,
    sources.length && `<div>This week's usage by product: ${sources.map(s => `${esc(s.name)} ${s.pct}%`).join(', ')}</div>`,
    `<div>Last updated ${fmtTime(at)}</div>`,
    '</div>',
  ].filter(Boolean).join('')
  return `<div class="statusbar-tooltip statusbar-limit-tip">${tip}</div>`
}

// The daily and weekly bars, sharing one tooltip
// The bars show from startup on, so they don't pop in later: `limits` is undefined while loading, null when unavailable
function UsageLimits({ limits }) {
  const ref         = useRef(null)
  const placeholder = limits === undefined ? '…' : '—'
  const tip         = limits ? usageTip(limits) : limits === undefined ? 'Loading Claude usage…' : "Claude usage isn't available - it needs Claude Code logged in with a Claude subscription"
  useEffect(() => { ref.current._tippy?.setContent(tip) }, [tip]) // the tooltip delegate re-reads data-tippy-html only on show, so update one already open
  return (
    <span ref={ref} className="statusbar-limits" data-tippy-interactive="true" data-tippy-maxwidth="none" data-tippy-html={tip}>
      <UsageBar label="Daily" limit={limits?.fiveHour} placeholder={placeholder} />
      <UsageBar label="Weekly" limit={limits?.sevenDay} placeholder={placeholder} />
    </span>
  )
}

// Asked at mount, on refocus, and every minute in case Claude Code was used meanwhile (schedule atop RateLimits.js)
function useRateLimits() {
  const [limits, setLimits] = useState() // undefined until the first answer; null without plan limits (API key logins) or if the SDK call fails
  useEffect(() => {
    const check = opts => document.hidden || window.api.getRateLimits(opts).then(setLimits)
    const onFocus = () => check()
    check()
    const timer = setInterval(() => check({ ifActive: true }), 60_000)
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [])
  return limits
}

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
  const [update, setUpdate]     = useState(null) // { current, latest } when an npm-global install is outdated, plus fromNpx for an npx run
  const [updating, setUpdating] = useState(false)
  const limits                  = useRateLimits()
  useEffect(() => { window.api.checkUpdate().then(setUpdate) }, [])
  const updater = { status: update, busy: updating, toggle: async () => { // the StatusSwitch service shape, for an action that always runs
    setUpdating(true)
    await window.api.installUpdate()
    setUpdating(false)
  } }
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
            {scanning ? 'Loading' : 'Loaded'} <span className="statusbar-num">{sessionCount}</span> sessions{scanning ? '…' : ''}
          </span>
          {scanning && (
            <span className="progress-bar">
              <span className="progress-bar-fill" style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>
      )}
      {update?.fromNpx && (
        <StatusSwitch service={updater} button="Install globally" className="statusbar-update" tooltip={npxTooltip} changes={<pre>{`npm i -g claude-discover@${update.latest}`}</pre>} changesTitle="Runs after the app closes">
          <ArrowDownToLine size={12} /> Install this app
        </StatusSwitch>
      )}
      {update && !update.fromNpx && (
        <StatusSwitch service={updater} button={`Update to v${update.latest}`} className="statusbar-update" tooltip={updateTooltip(update)} changes={<pre>{`npm i -g claude-discover@${update.latest}`}</pre>} changesTitle="Runs after the app closes">
          <ArrowDownToLine size={12} /> Update available
        </StatusSwitch>
      )}
      <UsageLimits limits={limits} />
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
