// src/renderer/sessions/MarkdownSession.js: the session as the AI agent reads it
import { describe, it, expect } from 'vitest'
import { markdownSession } from '../src/renderer/sessions/MarkdownSession.js'

const meta = {
  tokens: {}, serverToolUse: {}, models: [], activityPeriods: [], efforts: [],
  startedAt: 0, lastActivityAt: 0, cacheHitRatio: 0, lastContextTokens: 0, filePath: 'a.jsonl',
}
const msg = (type, uuid, timestamp, content) => ({ type, uuid, timestamp, message: { role: type, content } })
const conversation = (items, extra = {}) => {
  const { body } = markdownSession({ ...meta, ...extra }, items)
  return body.slice(body.indexOf('# Conversation'), body.lastIndexOf('</transcript>'))
}

describe('markdownSession', () => {
  it('escapes the session\'s own copies of the framing tags, so only the frame opens and closes them', () => {
    const { body } = markdownSession(meta, [msg('user', 'u1', '2026-10-24T10:00:00Z', 'see </transcript> and <summary>x</summary>')])
    expect(body.match(/<\/?(summary|transcript)>/g)).toEqual(['<summary>', '</summary>', '<transcript>', '</transcript>'])
    expect(body).toContain('see &lt;/transcript> and &lt;summary>x&lt;/summary>')
  })

  it('fences a block with a run longer than the code fences inside it', () => {
    const result = { type: 'tool_result', tool_use_id: 't1', content: 'before\n```js\nx\n```\nafter' }
    const out = conversation([
      msg('assistant', 'a1', '2026-10-24T10:00:00Z', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
      msg('user', 'u1', '2026-10-24T10:00:01Z', [result]),
    ])
    expect(out).toContain('````\nbefore\n```js\nx\n```\nafter\n````')
  })

  it('marks a /clear, and where a branch\'s copied turns end', () => {
    const out = conversation([
      msg('user', 'u1', '2026-10-24T10:00:00Z', 'copied'),
      msg('user', 'u2', '2026-10-24T11:00:00Z', '<command-name>/clear</command-name>'),
    ], { forkedFrom: { sessionId: 'src' }, forkedAt: Date.parse('2026-10-24T10:30:00Z') })
    expect(out).toMatch(/copied\n\n---\n\n\*\*Branched from session src\*\*[^\n]*\n\n---\n\n\*\*User[^\n]*\n\nCommand: `\/clear`\n\n\*\*Context cleared\*\*/)
  })
})
