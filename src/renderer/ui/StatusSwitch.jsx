import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import tippy from 'tippy.js'

// On/off feature switch in the StatusBar: tinted while `on`, optional ⚠ prefix, and a tooltip
// with the passed prose plus an Activate/Deactivate button — or, with a custom `button` label,
// an action button that always activates. Styles live in StatusBar.css.
//
// The ⚠ is a fixed-width slot kept in layout whenever the switch can warn (a `warn` prop is passed,
// even when false), so warn on/off doesn't shift the label. Callers wrap their own varying value in
// a .statusbar-state span for the same reason.

// Poll a main-process switch by name (5s, so external changes show up live) and expose its
// toggle. `isOn` reads the on-flag from the status shape (defaults to never-on, for
// action-style switches whose toggle always activates); toggle errors come back as
// `status.error`, alerted.
export function useSwitch({ name, isOn = () => false }) {
  const [status, setStatus] = useState(null) // null until the first probe answers
  const [busy, setBusy]     = useState(false)
  useEffect(() => {
    let alive = true
    const check = () => window.api.getSwitchStatus(name).then(s => alive && setStatus(s))
    check()
    const timer = setInterval(check, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  const toggle = async () => {
    setBusy(true)
    const next = await (isOn(status) ? window.api.deactivateSwitch(name) : window.api.activateSwitch(name))
    setStatus(next)
    setBusy(false)
    if (next.error) alert(next.error)
  }
  const setKeepActive = async value => {
    const next = await window.api.setSwitchKeepActive(name, value)
    setStatus(next)
    if (next.error) alert(next.error)
  }
  return { status, busy, toggle, setKeepActive }
}

export default function StatusSwitch({ service, on, warn, button, className = '', tooltip, children }) {
  const ref = useRef(null)
  // Interactive tippy (stays open under the cursor) with a live React body, portalled into its
  // container. main.jsx's global tippy delegate only targets [title] elements, so it skips this.
  const [tip] = useState(() => document.createElement('div'))
  useEffect(() => {
    const t = tippy(ref.current, { content: tip, interactive: true, delay: [0, 0], appendTo: () => document.body })
    return () => t.destroy()
  }, [])
  return (
    <span className={`statusbar-group statusbar-seg ${className} ${on ? 'statusbar-seg-on' : ''}`} ref={ref}>
      <span className={`statusbar-msg ${button ? '' : on ? 'statusbar-active' : 'statusbar-off'}`}>
        {warn !== undefined && <span className="statusbar-warn" data-on={warn ? '' : undefined}>⚠ </span>}
        {children}
      </span>
      {createPortal(
        <div className="statusbar-tooltip">
          {tooltip}
          <div className="statusbar-tooltip-footer">
            <button className={`button-primary statusbar-tooltip-btn ${button ? 'statusbar-tooltip-btn-blue' : on ? 'statusbar-tooltip-btn-red' : 'statusbar-tooltip-btn-green'}`} disabled={service.busy || !service.status} onClick={service.toggle}>
              {service.busy ? '…' : button || (on ? 'Deactivate' : 'Activate')}
            </button>
            {service.status?.keepActive !== undefined && (
              <label className="statusbar-tooltip-keep" title={service.status.ephemeral ? 'Not available for a temporary npx run — install the app first' : undefined}>
                <input type="checkbox" checked={service.status.keepActive} disabled={service.status.ephemeral} onChange={e => service.setKeepActive(e.target.checked)} />
                Keep active after close
              </label>
            )}
          </div>
        </div>,
        tip
      )}
    </span>
  )
}
