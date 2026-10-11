import { Tooltip } from 'react-tooltip'

// The arrow is only outlined via the border prop; "core" turns off all runtime style injection (main.jsx imports the CSS)
export default function Tip({ className = '', ...props }) {
  return <Tooltip className={`tip ${className}`} border="1px solid var(--tooltip-border)" arrowSize={11} portalRoot={document.body} disableStyleInjection="core" {...props} />
}
