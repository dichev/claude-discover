import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import tippy from 'tippy.js'
import './StatusSwitch.css'

// On/off feature switch in the StatusBar: tinted while `on`, with a tooltip carrying the prose and
// an Activate/Deactivate button — or, given a `button` label, an action button that always activates.
// The ⚠ slot keeps its width whenever a `warn` prop is passed (even when false), so toggling the
// warning doesn't shift the label — callers wrap varying values in .statusbar-state for the same reason.

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

export default function StatusSwitch({ service, on, warn, button, className = '', tooltip, changes, changesTitle = 'Changes in settings.json', children }) {
  const ref = useRef(null)
  // Interactive tippy (stays open under the cursor) with a live React body, portalled into its
  // container. main.jsx's global tippy delegate only targets [title] elements, so it skips this.
  const [tip]                     = useState(() => document.createElement('div'))
  const [showChanges, setChanges] = useState(false)
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
            {changes && showChanges && (
              <div className="statusbar-tooltip-changes">
                <div className="statusbar-tooltip-changes-title">{changesTitle}</div>
                {changes}
              </div>
            )}
            {service.status?.keepActive !== undefined && (
              <label className="statusbar-tooltip-keep" title={service.status.ephemeral ? 'Keep active is not available for a temporary npx run.\nInstall the app globally to enable it.' : undefined}>
                <input type="checkbox" checked={service.status.keepActive} disabled={service.status.ephemeral} onChange={e => service.setKeepActive(e.target.checked)} />
                Keep active after the app closes
              </label>
            )}
            <div className="statusbar-tooltip-actions">
              <button className={`button-primary statusbar-tooltip-btn ${button ? 'statusbar-tooltip-btn-blue' : on ? 'statusbar-tooltip-btn-red' : 'statusbar-tooltip-btn-green'}`} disabled={service.busy || !service.status} onClick={service.toggle}>
                {service.busy ? '…' : button || (on ? 'Deactivate' : 'Activate')}
              </button>
              {changes && (
                <button type="button" className="statusbar-tooltip-help" aria-expanded={showChanges} onClick={() => setChanges(v => !v)}>?</button>
              )}
            </div>
          </div>
        </div>,
        tip
      )}
    </span>
  )
}
