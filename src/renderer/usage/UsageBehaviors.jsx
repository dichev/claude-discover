import { Fragment, useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, WandSparkles } from 'lucide-react'
import { format, isToday, subDays } from 'date-fns'
import { fmtNum, fmtTime } from '../utils/formatting.js'
import './UsageBehaviors.css'

const PATTERNS = {
  cache_miss:         'Cache misses',
  long_context:       'Long context',
  subagent_heavy:     'Subagent-heavy sessions',
  high_parallel:      'Many sessions at once',
  cron:               'Scheduled runs',
  max_effort:         'Max effort',
  workflow:           'Workflows',
  always_on_context:  'Always-on context',
  large_tool_results: 'Large tool results',
  // a recommendation's key when it's about one named source
  agent:              'Subagent',
  skill:              'Skill',
  plugin:             'Plugin',
  mcp_server:         'MCP server',
}

// Skills named as their command
const SOURCES = [
  ['skills', 'Skills', s => `/${s}`],
  ['agents', 'Subagents'],
  ['plugins', 'Plugins'],
  ['mcp_servers', 'MCP servers'],
]

// A recommendation repeats its behavior's key and share, so they merge into one row; those about a named source ('agent', 'skill', …) stand alone
function rows(w) {
  const recs     = w.recommendations ?? []
  const behavior = new Set(w.behaviors.map(b => b.key))
  return [
    ...w.behaviors.map(b => ({ ...b, ...recs.find(r => r.key === b.key) })),
    ...recs.filter(r => !behavior.has(r.key)),
  ].sort((a, b) => b.pct - a.pct)
}

// Claude Code's own prompt for the tips it can act on; any /effort commands come first, each sent as its own message
function FixPrompt({ messages }) {
  const [copied, setCopied] = useState(null) // the index of the message just copied
  const copy = i => navigator.clipboard.writeText(messages[i]).then(() => {
    setCopied(i)
    setTimeout(() => setCopied(c => c === i ? null : c), 1500)
  })
  return (
    <details className="ub-fix">
      <summary className="button-primary"><WandSparkles size={12} /> Fix it with Claude Code <ChevronDown size={12} className="ub-chevron" /></summary>
      <p className="ub-gray">{messages.length > 1 ? 'Send these to Claude Code one by one' : 'Paste this into Claude Code'}, it shows each change before making it.</p>
      {messages.map((m, i) => (
        <div key={i} className="ub-fix-message">
          <pre>{m}</pre>
          <button type="button" onClick={() => copy(i)} title={copied === i ? 'Copied' : 'Copy'}>{copied === i ? <Check size={14} /> : <Copy size={14} />}</button>
        </div>
      ))}
    </details>
  )
}

// The share as a hairline under the name, quieter than a filled bar; a pattern /usage found but gave no tip for (so its screen doesn't list it) shows in grey
function Row({ r }) {
  return (
    <div className={`ub-row${r.title ? '' : ' ub-untipped'}`} title={r.count != null ? `${fmtNum(r.count)} requests` : undefined}>
      <div className="ub-share"><span>{PATTERNS[r.key] ?? r.key ?? r.title}</span><span className="ub-pct">{r.pct}%</span></div>
      <div className="ub-meter" style={{ '--pct': `${r.pct}%` }} />
      <div className="ub-gray">{r.title ? [r.title, r.detail].filter(Boolean).join(' · ') : "No tip from Claude Code, so /usage doesn't list it"}</div>
    </div>
  )
}

// A past day's snapshot is titled by the dates it covers
function Window({ title, label, days, w, at }) {
  const past    = !isToday(at)
  const sources = SOURCES.filter(([key]) => w[key]?.length)
  return (
    <section>
      <h3>
        {past ? `${label} · ${format(subDays(at, days), 'MMM d')} – ${format(at, 'MMM d')}` : title}
        <span className="ub-gray">{past ? `Snapshot of ${format(at, 'MMM d, h:mm a')}` : `Last updated ${fmtTime(at)}`}</span>
      </h3>
      <div>
        <div className="ub-label">Patterns</div>
        {rows(w).map(r => <Row key={r.key + r.title} r={r} />)}
      </div>
      {sources.length > 0 && (
        <div className="ub-top">
          {sources.map(([key, heading, name = s => s]) => (
            <div key={key} className="ub-source">
              <div className="ub-label">{heading}</div>
              {w[key].map(s => <Fragment key={s.name}><span>{name(s.name)}</span><span className="ub-gray">{s.pct}%</span></Fragment>)}
            </div>
          ))}
        </div>
      )}
      {w.fix && <FixPrompt messages={w.fix.messages} />}
    </section>
  )
}

let rescanned = false // once per page load, so a reload rescans (for debugging)

// The period's latest scan, or the snapshot kept for a past one; read again every minute, as the main process scans on its own schedule
function useInsights(date, granularity) {
  const [insights, setInsights] = useState()
  useEffect(() => {
    let cancelled = false
    const check = () => document.hidden || window.api.getUsageInsights({ date, granularity, force: !rescanned }).then(s => cancelled || setInsights(s))
    check()
    rescanned = true
    const timer = setInterval(check, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [date, granularity])
  return insights
}

// What /usage says is contributing to the plan's usage, from Claude Code's scan of this machine's transcripts
export default function UsageBehaviors({ date, granularity }) {
  const behaviors = useInsights(date, granularity)
  if (!behaviors) return <div>Select a session to inspect.</div> // loading, unavailable (API key logins), or no snapshot for the period
  return (
    <div className="usage-behaviors">
      <h2>What's contributing the most to your usage?</h2>
      <p className="ub-gray ub-note">Patterns in how you used Claude Code on this computer, each with a tip to use less of your limits. The numbers are approximate, and a request can count in more than one pattern.</p>
      {behaviors.day && <Window title="Last 24h" label="Daily" days={1} w={behaviors.day} at={behaviors.at} />}
      {behaviors.week && <Window title="Last 7d" label="Weekly" days={7} w={behaviors.week} at={behaviors.at} />}
    </div>
  )
}
