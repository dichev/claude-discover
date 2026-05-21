import React, { useEffect, useRef } from 'react'
import tippy from 'tippy.js'
import './StatusBar.css'

const TOOLTIP = `
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

export default function StatusBar() {
  const tipRef = useRef(null)

  useEffect(() => {
    if (!tipRef.current) return
    const instance = tippy(tipRef.current, { content: TOOLTIP, allowHTML: true, delay: [0, 0] })
    return () => instance.destroy()
  }, [])

  const installed = window.api.hookInstalled

  return (
    <div className="statusbar">
      <span className="statusbar-group" ref={tipRef}>
        <span className={`statusbar-msg ${installed ? 'statusbar-on' : 'statusbar-off'}`}>
          Capture context hook : {installed ? 'ON' : 'off'}
        </span>
      </span>
    </div>
  )
}
