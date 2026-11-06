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

  it('lists the MCP servers each prompt\'s request had above it, and later only what changed', () => {
    const row = (name, status, more = {}) => ({
      name, transport: null, status, ms: null, readyWithin: null, error: null, stderr: [], toolCount: null, groups: [], tools: [], ...more,
    })
    const mcp = [
      { startedAt: '2026-11-04T21:33:11.744Z', change: false, servers: [
        row('browser', 'failed', { error: 'CONNECTION_CLOSED: Connection closed' }),
        row('pycharm', 'connected', { toolCount: 52, tools: [{ name: 'run', ms: 250, error: null }, { name: 'lint', ms: 5, error: 'no file' }] }),
        row('toolbox', 'connected', { toolCount: 9, groups: [{ name: 'clients', toolCount: 5 }, { name: 'meta', toolCount: 4 }] }),
      ] },
      { startedAt: '2026-11-04T21:34:00.100Z', change: true, servers: [row('playwright', 'connected', { readyWithin: 9000, toolCount: 25 })] },
    ]
    const items = [msg('user', 'u1', '2026-11-04T21:33:11.700Z', 'hi'), msg('user', 'u2', '2026-11-04T21:34:00.000Z', 'more')]
    const { body } = markdownSession(meta, items, { mcp })
    expect(body).toMatch(new RegExp('\\*\\*System · \\d\\d:\\d\\d:\\d\\d:\\*\\*\n\n_MCP servers_\n'
      + '- browser: failed \\(CONNECTION_CLOSED: Connection closed\\)\n'
      + '- pycharm: connected, 52 tools\n  - tool run: 250ms\n  - tool lint: 5ms \\(failed: no file\\)\n'
      + '- toolbox: connected, 9 tools\n  - mounted clients: 5 tools\n  - mounted meta: 4 tools\n\n---\n\n\\*\\*User'))
    expect(body).toMatch(/\*\*System · \d\d:\d\d:\d\d:\*\*\n\n_MCP servers changed_\n- playwright: connected within 9000ms of the request that found it connecting, 25 tools\n\n---\n\n\*\*User/)
  })

  it('lists the MCP servers a turn connected to above its prompt, and the debug log they came from', () => {
    const mcp = [{ startedAt: '2026-11-04T21:33:11.451Z', debug: true, servers: [
      { name: 'stdio_echo', transport: 'stdio', status: 'connected', ms: 164, error: null, stderr: [], toolCount: 2, groups: [], tools: [] },
      { name: 'broken', transport: null, status: 'failed', ms: 59, error: 'CONNECTION_CLOSED: Connection closed', stderr: ['boom'], groups: [], tools: [] },
    ] }]
    const { body } = markdownSession(meta, [msg('user', 'u1', '2026-11-04T21:33:11.744Z', 'hi')], { mcp }, null, 'debug/s.txt')
    expect(body).toMatch(new RegExp('\\*\\*System · \\d\\d:\\d\\d:\\d\\d:\\*\\*\n\n_MCP servers connected \\(debug log\\)_\n'
      + '- stdio_echo: stdio, connected in 164ms, 2 tools\n'
      + '- broken: failed in 59ms \\(CONNECTION_CLOSED: Connection closed\\)\n  - stderr: boom\n\n---\n\n\\*\\*User'))
    expect(body).toContain('- Debug log: debug/s.txt')
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
