import { createContext, useContext, useState } from 'react'

// Global expand/collapse signal: null = leave each collapsible on its own state,
// true/false = force open/closed. Changing it re-applies to every collapsible.
export const ExpandAllContext = createContext(null)

export function useCollapsed(defaultOpen) {
  const expandAll             = useContext(ExpandAllContext)
  const [open, setOpen]       = useState(expandAll ?? defaultOpen)
  const [applied, setApplied] = useState(expandAll)
  if (applied !== expandAll) {
    setApplied(expandAll)
    if (expandAll != null) setOpen(expandAll)
  }
  return [open, setOpen]
}
