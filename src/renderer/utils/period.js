import {
  startOfDay, endOfDay, addDays, isSameDay,
  startOfWeek, endOfWeek, addWeeks, isSameWeek,
  startOfMonth, endOfMonth, addMonths, isSameMonth,
} from 'date-fns'

// Week-scoped views start on Monday — keep this in sync with periodBounds() in
// src/main/services/SessionsService.js.
const WEEK = { weekStartsOn: 1 }

export function startOfPeriod(ts, granularity) {
  if (granularity === 'week') return +startOfWeek(ts, WEEK)
  if (granularity === 'month') return +startOfMonth(ts)
  return +startOfDay(ts)
}

export function endOfPeriod(ts, granularity) {
  if (granularity === 'week') return +endOfWeek(ts, WEEK)
  if (granularity === 'month') return +endOfMonth(ts)
  return +endOfDay(ts)
}

export function addPeriod(ts, granularity, delta) {
  if (granularity === 'week') return +addWeeks(ts, delta)
  if (granularity === 'month') return +addMonths(ts, delta)
  return +addDays(ts, delta)
}

export function isSamePeriod(a, b, granularity) {
  if (granularity === 'week') return isSameWeek(a, b, WEEK)
  if (granularity === 'month') return isSameMonth(a, b)
  return isSameDay(a, b)
}
