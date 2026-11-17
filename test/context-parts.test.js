import { describe, it, expect } from 'vitest'
import { contextParts } from '../src/renderer/sessions/context/contextParts.js'
import { countTokens as tokens } from '../src/shared/tokenizer/claudeTokenizer.js'

describe('contextParts', () => {
  const strip = (file_path, rest = {}) => ({ type: 'instruction', it: { source: 'message', file_path, content: `${file_path} text`, hash: file_path, ...rest } })
  const att = (type, rest = {}) => ({ type: 'attachment', folded: true, attachment: { type, ...rest }, rendered: [{ content: `${type} text` }] })
  const parts = blocks => contextParts([{ role: 'system', blocks }], 100000)

  it('splits loaded tools into system and MCP ones, skills by plugin, and leaves the rest of the context to Messages', () => {
    const skills = '- a:one: first\n- a:two: second\n- b:three: third\n- mine: my own'
    const found = parts([
      strip('System Tools', { items: [{ name: 'Read', content: 'r' }, { name: 'mcp__docs__find', content: 'f' }] }),
      att('skill_listing', { content: skills, skillCount: 4 }),
    ])
    expect(found.find(p => p.key === 'skills').children.map(c => c.name)).toEqual(['plugin a', 'plugin b', 'Built-in & user'])
    expect(found.find(p => p.key === 'systemTools').children.map(c => c.name)).toEqual(['Read'])
    expect(found.find(p => p.key === 'mcpTools').children.map(c => c.name)).toEqual(['docs'])
    const counted = found.filter(p => p.key !== 'messages').reduce((a, p) => a + p.tokens, 0)
    expect(found[0]).toMatchObject({ key: 'messages', tokens: 100000 - counted })
  })

  it('counts what Claude Desktop has no category for as kinds of Messages: deferred tool names, the agent listing, injected reminders', () => {
    const found = parts([
      strip('System Tools', { items: [{ name: 'Read', content: 'r' }] }),
      strip('Deferred Tools', { items: [{ name: 'System', content: 'Monitor' }, { name: 'docs MCP', content: 'mcp__docs__search' }] }),
      strip('Agent Types', { items: [{ name: 'Explore', content: 'searches' }, { name: 'a:reviewer', content: 'reviews' }] }),
      strip('Date', { content: 'monday', hash: 'd1' }), strip('Date', { content: 'tuesday', hash: 'd2' }),
    ])
    expect(found.map(p => p.key)).toEqual(['messages', 'systemTools']) // in a fixed order, whatever their sizes
    expect(Object.fromEntries(found[0].children.map(c => [c.name, c.tokens]))).toMatchObject({
      'Deferred tool names': tokens('System: Monitor') + tokens('docs MCP: mcp__docs__search'),
      'Agent types': tokens('Explore: searches') + tokens('a:reviewer: reviews'),
      'Session context': tokens('monday') + tokens('tuesday'),
    })
  })

  it('counts a re-sent system prompt or memory file once, as last sent', () => {
    const found = parts([
      strip('System Prompt', { source: 'system', content: 'old prompt', hash: 'p1' }), strip('System Prompt', { source: 'system', content: 'the new prompt', hash: 'p2' }),
      strip('D:/project/CLAUDE.md', { name: 'CLAUDE.md', memory_type: 'Project', content: 'v1', hash: 'm1' }),
      strip('D:/project/CLAUDE.md', { name: 'CLAUDE.md', memory_type: 'Project', content: 'v2 longer', hash: 'm2' }),
    ])
    expect(found.find(p => p.key === 'prompt').tokens).toBe(tokens('the new prompt'))
    expect(found.find(p => p.key === 'memory').children).toEqual([{ name: 'CLAUDE.md (Project)', tokens: tokens('v2 longer') }])
  })

  it('counts a listing sent again word for word once, and no attachment from before the last compaction', () => {
    const listing = () => att('skill_listing', { content: '- mine: my own', skillCount: 1 })
    const found = contextParts([
      { role: 'system', blocks: [strip('System Prompt', { source: 'system' }), listing(), att('date')] },
      { role: 'compact', blocks: [{ summary: 'what came before' }] },
      { role: 'system', blocks: [listing(), listing()] },
    ], 100000)
    expect(found.find(p => p.key === 'skills').tokens).toBe(tokens('mine: my own'))
    expect(found.find(p => p.key === 'prompt').tokens).toBe(tokens('System Prompt text'))
    expect(found.find(p => p.key === 'messages').children.map(c => c.name)).toEqual(['Compact summary', 'API overhead & unsplit'])
  })

  it('drops the messages and attachments from before a /clear, as a compaction does', () => {
    const found = contextParts([
      { role: 'system', blocks: [strip('System Prompt', { source: 'system' }), att('date')] },
      { role: 'user', blocks: [{ type: 'text', text: 'before the clear' }] },
      { role: 'user', blocks: [{ type: 'text', text: '<command-name>/clear</command-name>' }] },
    ], 100000)
    expect(found.find(p => p.key === 'prompt').tokens).toBe(tokens('System Prompt text'))
    expect(found.find(p => p.key === 'messages').children.find(c => c.name === 'User messages').tokens).toBe(tokens('<command-name>/clear</command-name>'))
  })

  it('drops the reminders from before the last compaction, and the roster from before it once one is announced since', () => {
    const before = [strip('System Prompt', { source: 'system' }), strip('Deferred Tools', { items: [{ name: 'System', content: 'Monitor' }] }), strip('Date', { content: 'monday' })]
    const kinds = since => Object.fromEntries(contextParts([{ role: 'system', blocks: before }, { role: 'compact', blocks: [{ summary: 'what came before' }] }, { role: 'system', blocks: since }], 100000)
      .find(p => p.key === 'messages').children.map(c => [c.name, c.tokens]))
    const added = ['Monitor', 'CronCreate']
    expect(kinds([att('deferred_tools_delta', { addedNames: added }), att('date')])).toMatchObject({ 'Deferred tool names': tokens(JSON.stringify({ added }, null, 2)), 'Session context': tokens('date text') })
    // announced again word for word, it is listed only that first time
    expect(kinds([att('date')])).toMatchObject({ 'Deferred tool names': tokens('System: Monitor'), 'Session context': tokens('date text') })
  })

  it('counts a deferred tool only while the ToolSearch result naming it is in the conversation', () => {
    const tools = { role: 'system', blocks: [strip('System Tools', { items: [{ name: 'Read', content: 'r' }, { name: 'Monitor', content: 'm', deferred: true }, { name: 'mcp__docs__find', content: 'f', deferred: true }] })] }
    const search = { role: 'assistant', blocks: [{ type: 'tool_use', name: 'ToolSearch', input: {}, result: { content: [{ type: 'tool_reference', tool_name: 'Monitor' }] } }] }
    const counted = turns => contextParts(turns, 100000).filter(p => p.key !== 'messages').flatMap(p => p.children.map(c => c.name)).sort()
    expect(counted([tools, search])).toEqual(['Monitor', 'Read'])
    // a compaction drops the result with the other messages
    expect(counted([tools, search, { role: 'compact', blocks: [{ summary: 'what came before' }] }])).toEqual(['Read'])
  })

  it('splits Messages by kind from the turns since the last compaction, leaving what it could not size unsplit', () => {
    const system = { role: 'system', blocks: [strip('System Prompt', { source: 'system', content: 'prompt', hash: 'p' })] }
    const turns = [
      system,
      { role: 'user', blocks: [{ type: 'text', text: 'before the compaction' }] },
      { role: 'compact', blocks: [{ summary: 'what came before' }] },
      { role: 'user', blocks: [{ type: 'text', text: 'fix it' }] },
      { role: 'assistant', blocks: [{ type: 'thinking', thinking: 'let me look' }, { type: 'tool_use', input: { path: 'a.js' }, result: { content: [{ type: 'text', text: 'code' }] } }] },
      { role: 'assistant', blocks: [{ type: 'text', text: 'done' }] },
    ]
    const messages = contextParts(turns, 100000).find(p => p.key === 'messages')
    const sized = {
      'Compact summary': tokens('what came before'), 'User messages': tokens('fix it'), Thinking: tokens('let me look'),
      'Tool calls': tokens('{"path":"a.js"}'), 'Tool results': tokens('code'), 'Claude messages': tokens('done'),
    }
    expect(Object.fromEntries(messages.children.slice(0, -1).map(c => [c.name, c.tokens]))).toEqual(sized)
    expect(messages.children.at(-1)).toEqual({ name: 'API overhead & unsplit', tokens: messages.tokens - Object.values(sized).reduce((a, n) => a + n, 0) })
  })

  it('scales the split down when its estimate runs past the size', () => {
    const turns = [{ role: 'system', blocks: [strip('System Prompt', { source: 'system' })] }, { role: 'user', blocks: [{ type: 'text', text: 'word '.repeat(500) }] }]
    expect(contextParts(turns, tokens('System Prompt text') + 100).find(p => p.key === 'messages').children).toEqual([{ name: 'User messages', tokens: 100 }])
  })

  it('reads the context before a compaction from the turns up to it, and after it only what it left', () => {
    const at = time => new Date(`2026-10-24T${time}`).getTime()
    const user = (text, time) => ({ role: 'user', ts: at(time), blocks: [{ type: 'text', text }] })
    const compact = (time, preTokens) => ({ role: 'compact', ts: at(time), blocks: [{ summary: 'what came before', preTokens }] })
    const system = { role: 'system', blocks: [strip('System Prompt', { source: 'system' })] }
    const turns = [system, user('first', '10:00'), compact('10:30', 5000), user('second', '11:00'), compact('11:30'), user('third', '12:00'), compact('12:30', 3000), user('fourth', '13:00')]
    const before = contextParts(turns.slice(0, 2), 5000)
    const next   = contextParts(turns.slice(0, 6), 3000) // before the next one
    expect(before.reduce((a, p) => a + p.tokens, 0)).toBe(5000)
    expect(before.find(p => p.key === 'messages').children[0]).toEqual({ name: 'User messages', tokens: tokens('first') })
    // only what the compaction before it left
    expect(next.find(p => p.key === 'messages').children.map(c => c.name)).toEqual(['Compact summary', 'User messages', 'API overhead & unsplit'])
    expect(next.find(p => p.key === 'messages').children[1].tokens).toBe(tokens('third'))
  })

  it('draws nothing when no System row was logged', () => {
    expect(parts([])).toEqual([])
  })
})
