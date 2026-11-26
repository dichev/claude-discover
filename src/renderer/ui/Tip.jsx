import { Tooltip } from 'react-tooltip'

// The arrow is only outlined via the border prop; "core" turns off all runtime style injection (main.jsx imports the CSS)
// Fixed, so a tip that grows past the window edge before it repositions doesn't flash a page scrollbar
export default function Tip({ className = '', ...props }) {
  return <Tooltip className={`tip ${className}`} border="1px solid var(--tooltip-border)" arrowSize={11} portalRoot={document.body} positionStrategy="fixed" disableStyleInjection="core" {...props} />
}
