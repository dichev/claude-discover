import { useEffect, useId, useState } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import { format, isToday } from 'date-fns'
import StatusSwitch, { useSwitch } from './StatusSwitch'
import ProgressBar from './ProgressBar.jsx'
import Tip from './Tip.jsx'
import { tone } from '../utils/formatting'
import { useScanProgress } from '../utils/useScanProgress.js'
import { useClock } from '../utils/useClock.js'
import { THRESHOLDS } from '../utils/thresholds'
import './StatusBar.css'

// Tooltip prose for each switch; StatusSwitch appends the live Activate/Deactivate button below it.
const proxyTooltip = <>
  <p>Captures Claude Code's raw API traffic - requests and responses, including the side requests (title, auto-mode checks, …) the transcript doesn't log.</p>
  <p>Applies to running Claude Code sessions too.</p>
</>
const proxyChanges = <>
  <pre>{`"env": {
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:41414"
}`}</pre>
  <p>Also registers the proxy as a login service so it survives restarts.</p>
  <p>Note: <code>/remote-control</code> is disabled while proxy is active.</p>
</>

const settingsTooltip = <>
  <p>Claude Code settings that let this app show more:</p>
  <ul>
    <li><b>Keep session logs for a year</b> - Claude Code deletes them after 30 days by default.</li>
    <li><b>Show Claude's thinking</b> - a summary of how it reasoned, which Claude Code leaves empty by default.</li>
  </ul>
</>
const settingsChanges = <>
  <pre>{`"cleanupPeriodDays": 365,
"showThinkingSummaries": true`}</pre>
  <p>Deactivate keeps the 1-year logs, so it shows 1/2. Going back to 30 days would permanently delete older sessions.</p>
</>
const settingsLabel = s => !s ? '…' : s.applied === s.total ? 'ON' : s.applied ? `${s.applied}/${s.total}` : 'off'

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

// "4:30 PM" today, "Wed 1:00 PM" later
const fmtTime = ts => format(ts, isToday(ts) ? 'h:mm a' : 'EEE h:mm a')

// One tooltip row per limit: label, bar, used %, and when it resets
function LimitRow({ label, w }) {
  const pct     = Math.floor(w.utilization)
  const pctTone = tone(pct, THRESHOLDS.limit)
  const resets  = useClock(() => w.resetsAt > Date.now() ? `resets ${isToday(w.resetsAt) ? 'at ' : ''}${fmtTime(w.resetsAt)}` : '')
  return <>
    <span>{label}</span>
    <ProgressBar pct={pct} tone={pctTone} />
    <span className={`tip-pct ${pctTone}`}>{pct}%</span>
    <span className="tip-faint">{resets}</span>
  </>
}

// `limit` is missing while loading or when usage isn't available; the bar then stays empty
function UsageBar({ label, limit, placeholder }) {
  const pct     = limit ? Math.floor(limit.utilization) : null
  const pctTone = tone(pct, THRESHOLDS.limit)
  return (
    <span className={`statusbar-group statusbar-limit ${pctTone}`}>
      <span>{label}</span>
      <ProgressBar pct={pct} tone={pctTone} />
      <span className="statusbar-num">{pct != null ? `${pct}%` : placeholder}</span>
    </span>
  )
}

// Everything /usage reported, as the bars' tooltip
function UsageTip({ at, plan, fiveHour, sevenDay, models, sources, extra }) {
  const money    = n => new Intl.NumberFormat(undefined, { style: 'currency', currency: extra.currency || 'USD' }).format(n / 10 ** extra.decimals)
  const userOff  = extra && !extra.on && !extra.reason
  const extraPct = extra?.limit ? Math.floor((extra.used ?? 0) / extra.limit * 100) : 0
  return (
    <div className="statusbar-tooltip statusbar-limit-tip">
      <div className="tip-head"><b>Claude Usage{plan && ` (${plan[0].toUpperCase() + plan.slice(1)})`}</b></div>
      <div className="tip-limits">
        {fiveHour && <LimitRow label="Daily" w={fiveHour} />}
        {sevenDay && <LimitRow label="Weekly" w={sevenDay} />}
        {models.map(m => <LimitRow key={m.name} label={`Weekly (${m.name})`} w={m} />)}
        {extra && <>
          <span className="tip-sep" /><span>Extra usage</span>
          {userOff ? <span /> : <ProgressBar pct={extraPct} tone={tone(extraPct, THRESHOLDS.limit)} />}
          <span className="tip-pct">{userOff ? 'off' : money(extra.used ?? 0)}</span>
          <span className="tip-faint">{userOff ? '' : extra.limit != null ? `of ${money(extra.limit)} this month` : 'this month'}</span>
        </>}
      </div>
      <div className="tip-foot">
        {sources.length > 0 && <div>This week's usage by product: {sources.map(s => `${s.name} ${s.pct}%`).join(', ')}</div>}
        <div>Last updated {fmtTime(at)}</div>
      </div>
    </div>
  )
}

// The daily and weekly bars, sharing one tooltip
// The bars show from startup on, so they don't pop in later: `limits` is undefined while loading, null when unavailable
function UsageLimits({ limits }) {
  const id          = useId()
  const placeholder = limits === undefined ? '…' : '—'
  const tip         = limits ? <UsageTip {...limits} /> : limits === undefined ? 'Loading Claude usage…' : "Claude usage isn't available - it needs Claude Code logged in with a Claude subscription"
  return (
    <span className="statusbar-limits" data-tooltip-id={id}>
      <UsageBar label="Daily" limit={limits?.fiveHour} placeholder={placeholder} />
      <UsageBar label="Weekly" limit={limits?.sevenDay} placeholder={placeholder} />
      <Tip id={id} clickable className="tip-unbounded statusbar-tip">
        {tip}
      </Tip>
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

export default function StatusBar({ sessionCount = 0 }) {
  const { claudeDir } = window.api.claudeSettings
  // Status shapes come from the matching *Switch in src/main/services/switchers/:
  // proxy { running, configured } · statusline { installed } · settings { applied, total } · claudedir { dir }
  const proxy      = useSwitch({ name: 'proxy',      isOn: s => s?.running && s.configured })
  const statusline = useSwitch({ name: 'statusline', isOn: s => s?.installed })
  const settings   = useSwitch({ name: 'settings',   isOn: s => s && s.applied === s.total })
  const claudedir  = useSwitch({ name: 'claudedir' }) // action-style: its button always activates (opens the folder picker)
  const [update, setUpdate]     = useState(null) // { type: 'update', current, latest, spec } when a global install is outdated, or { type: 'install', spec } for an npx run
  const [updating, setUpdating] = useState(false)
  const limits                  = useRateLimits()
  const progress                = useScanProgress()
  useEffect(() => {
    window.api.checkUpdate().then(setUpdate)
    const timer = setInterval(() => window.api.checkUpdate().then(setUpdate), 6 * 60 * 60_000) // an app left open for days still hears of new releases
    return () => clearInterval(timer)
  }, [])
  const updater = { status: update, busy: updating, toggle: async () => { // the StatusSwitch service shape, for an action that always runs
    setUpdating(true)
    await window.api.installUpdate()
    setUpdating(false)
  } }
  const npx       = update?.type === 'install'
  const proxyOn   = proxy.status?.running && proxy.status.configured
  const proxyDown = proxy.status?.configured && proxy.status.running === false // Claude Code is pointed at a dead proxy — it can't reach the API
  const settingsOn = settings.status && settings.status.applied === settings.status.total
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
          {scanning && <ProgressBar pct={pct} />}
        </span>
      )}
      {update && (
        <StatusSwitch service={updater} button={npx ? 'Install globally' : `Update to v${update.latest}`} className="statusbar-update" tooltip={npx ? npxTooltip : updateTooltip(update)} changes={<pre>{`npm i -g ${update.spec}`}</pre>} changesTitle="Runs after the app closes">
          <ArrowDownToLine size={12} /> {npx ? 'Install this app' : 'Update available'}
        </StatusSwitch>
      )}
      <UsageLimits limits={limits} />
      <StatusSwitch service={settings} on={settingsOn} warn={!!(settings.status && !settingsOn)} tooltip={settingsTooltip} changes={settingsChanges}>
        Claude settings : <span className="statusbar-state">{settingsLabel(settings.status)}</span>
      </StatusSwitch>
      <StatusSwitch service={proxy} on={proxyOn} warn={!!proxyDown} tooltip={proxyTooltip} changes={proxyChanges}>
        Capture proxy : <span className="statusbar-state">{proxyOn ? 'ON' : proxyDown ? 'DOWN' : 'off'}</span>
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
