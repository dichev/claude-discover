import { useEffect, useId, useRef, useState } from 'react'
import './MultiPicker.css'

// A dropdown of checkable options in a native popover (Esc / click outside close it).
// Click an option to pick only it and close; its checkbox or Ctrl/Cmd/Shift-click adds/removes it.
// The boxes show on hover or while one of those keys is held. An empty `value` means "all".
//   options: [{ value, label, detail?, group? }] — a divider goes wherever `group` changes
const isMulti = e => e.ctrlKey || e.metaKey || e.shiftKey

export default function MultiPicker({ options, value, onChange, allLabel = 'All' }) {
  const [multi, setMulti] = useState(false)
  const popoverRef        = useRef(null)
  const id                = useId()
  const anchor            = `--multi-picker-${id.replace(/[^\w-]/g, '')}` // useId's chars aren't valid in a CSS ident

  const labelOf = v => options.find(o => o.value === v)?.label ?? v
  const label = value.length === 0 ? allLabel : `${labelOf(value[0])}${value.length > 1 ? ` +${value.length - 1}` : ''}`

  // v null = the "all" option, which clears the selection
  const choose = (v, e) => {
    const additive = isMulti(e) || e.target.type === 'checkbox'
    if (!additive) {
      onChange(v == null ? [] : [v])
      popoverRef.current.hidePopover()
    }
    else if (v == null) onChange([])
    else onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  }

  useEffect(() => {
    const track = e => setMulti(isMulti(e))
    const reset = () => setMulti(false) // a key released outside the window never sends keyup
    window.addEventListener('keydown', track)
    window.addEventListener('keyup', track)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', track)
      window.removeEventListener('keyup', track)
      window.removeEventListener('blur', reset)
    }
  }, [])

  const row = (v, text, extra, checked) => (
    <div
      key={v ?? ''}
      className="multi-picker-option"
      tabIndex={0}
      onClick={e => choose(v, e)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(v, e) } }}
    >
      {/* The row handles its clicks too, so it stays the one place selection changes */}
      <input type="checkbox" checked={checked} readOnly tabIndex={-1} />
      <span className="multi-picker-option-label">{text}</span>
      {extra}
    </div>
  )

  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        className={`multi-picker${value.length ? ' active' : ''}`}
        style={{ anchorName: anchor }}
      >
        <span className="multi-picker-label">{label}</span>
        <span className="multi-picker-icon">▾</span>
      </button>
      {/* Shift-click would extend the page's text selection into the list */}
      <div
        id={id}
        popover="auto"
        ref={popoverRef}
        className={`multi-picker-popover${multi ? ' multi' : ''}`}
        style={{ positionAnchor: anchor }}
        onMouseDown={e => { if (e.shiftKey) e.preventDefault() }}
      >
        {row(null, allLabel, <span className="multi-picker-hint">hold Shift to multi-select</span>, value.length === 0)}
        <hr />
        {options.flatMap((o, i) => [
          i > 0 && o.group !== options[i - 1].group && <hr key={`hr-${o.value}`} />,
          row(o.value, o.label, o.detail && <span className="multi-picker-option-detail">{o.detail}</span>, value.includes(o.value)),
        ])}
      </div>
    </>
  )
}
