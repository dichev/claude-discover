import { describe, it, expect } from 'vitest'
import { fmtDuration } from '../src/renderer/utils/formatting.js'

describe('fmtDuration', () => {
  it('gives seconds, then minutes and seconds, then hours and minutes', () => {
    expect(fmtDuration(0)).toBe('—')
    expect(fmtDuration(42_000)).toBe('42s')
    expect(fmtDuration(125_000)).toBe('2m 5s')
    expect(fmtDuration(2 * 3_600_000 + 30 * 60_000)).toBe('2h 30m')
  })

  it('keeps the hours of a day or more', () => {
    expect(fmtDuration(39.5 * 3_600_000)).toBe('39h 30m')
  })
})
