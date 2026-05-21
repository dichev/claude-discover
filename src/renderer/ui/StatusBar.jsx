import React, { useEffect, useState } from 'react'
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

const USAGE_TOOLTIP = `
  <div class="statusbar-tooltip">
    <p>Polls <code>api.anthropic.com/api/oauth/usage</code> with the OAuth token from your local Claude Code config for your 5-hour and 7-day plan utilization.</p>
    <p>This in an unofficial endpoint — may break without notice.</p>
    <!--ERROR-->
  </div>
`

export default function StatusBar() {
  const [usage, setUsage] = useState(null)
  const installed         = window.api.hookInstalled

  useEffect(() => {
    const apply = u => { if (u) setUsage(u) }
    window.api.getAgentUsage().then(apply)
    return window.api.onAgentUsage(apply)
  }, [])

  return (
    <div className="statusbar">
      {usage && (usage.error
        ? <span className="statusbar-msg statusbar-unavailable" title={USAGE_TOOLTIP.replace('<!--ERROR-->', `<pre class="statusbar-tooltip-error">Error: ${usage.error}</pre>`)}>
            Claude usage: unavailable
          </span>
        : <span className="statusbar-msg statusbar-on" title={USAGE_TOOLTIP}>Claude usage: ON</span>
      )}
      <span className="statusbar-group" title={HOOK_TOOLTIP}>
        <span className={`statusbar-msg ${installed ? 'statusbar-on' : 'statusbar-off'}`}>
          Capture context hook : {installed ? 'ON' : 'off'}
        </span>
      </span>
    </div>
  )
}
