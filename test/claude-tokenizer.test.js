import { describe, it, expect } from 'vitest'
import { countTokens } from '../src/shared/tokenizer/claudeTokenizer.js'
import fixture from './fixtures/tokenizer.json' with { type: 'json' }

describe('countTokens', () => {
  // the recorded counts are for a whole message, whose frame can add a token at the start of the text
  it('counts code and prose in several scripts as the API did, give or take the message frame\'s token', () => {
    for (const { name, text, tokens } of fixture.recorded) {
      expect(Math.abs(countTokens(text) - tokens), name).toBeLessThanOrEqual(1)
    }
  })

  it('agrees with ctok on markdown, code, contractions, casing, quotes, emoji and whitespace', () => {
    for (const { text, tokens } of fixture.ctok) {
      expect(countTokens(text), JSON.stringify(text)).toBe(tokens)
    }
  })

  it('counts nothing for what the API drops: carriage returns and the reserved tag namespace', () => {
    expect(countTokens('a\r\nb')).toBe(countTokens('a\nb'))
    expect(countTokens('<' + 'antml:invoke name="x">')).toBe(countTokens('<invoke name="x">'))
  })

  it('counts a long run of blank lines inside a text without stalling', () => {
    const start = performance.now()
    expect(countTokens('a' + '\n'.repeat(200_000) + 'b')).toBeGreaterThan(2)
    expect(performance.now() - start).toBeLessThan(2000) // the run took 22s when the final-newline trim backtracked over it
  })
})
