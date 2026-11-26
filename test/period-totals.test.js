import { describe, it, expect } from 'vitest'
import { bucketTotals } from '../src/renderer/timeline/periodTotals.js'

describe('bucketTotals', () => {
  it('counts a sample where it began, one from before the first bucket in the first', () => {
    const sessions = [
      { costSamples: [{ start: -5, cost: 1, tokens: 10 }, { start: 10, cost: 2, tokens: 20 }] },
      { costSamples: [{ start: 19, cost: 4, tokens: 40 }, { start: 25, cost: 8, tokens: 80 }] },
      {}, // a session with no samples
    ]
    expect(bucketTotals([0, 10, 20], sessions)).toEqual([
      { start: 0, cost: 1, tokens: 10 },
      { start: 10, cost: 6, tokens: 60 },
      { start: 20, cost: 8, tokens: 80 },
    ])
  })
})
