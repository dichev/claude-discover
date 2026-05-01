import { intervalToDuration } from 'date-fns'

export function fmtDuration(ms) {
  if (!ms || ms < 0) return '—'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const { hours = 0, minutes = 0, seconds = 0 } = intervalToDuration({ start: 0, end: ms })
  if (!hours) return `${minutes}m ${seconds}s`
  return `${hours}h ${minutes}m`
}

export function fmtBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function fmtNum(n) {
  if (n == null) return '—'
  return n.toLocaleString()
}

export function fmtUSD(n) {
  if (n == null) return '—'
  // if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

// Fixed thresholds tuned for the $100/mo plan (~$3.33/day budget).
// A single session crossing $5 / 10M tokens is "too expensive"; $1 / 2M is "watch it".
export function costTone(cost) {
  if (!cost) return 'muted'
  if (cost >= 5) return 'danger'
  if (cost >= 1) return 'warn'
  return 'muted'
}

export function tokensTone(tokens) {
  if (!tokens) return 'muted'
  if (tokens >= 5_000_000) return 'danger'
  if (tokens >= 1_000_000) return 'warn'
  return 'muted'
}

export function fmtCompact(n) {
  if (n == null) return '—'
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${+(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}