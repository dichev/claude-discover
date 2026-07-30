import { describe, it, expect } from 'vitest'
import { parseCommand, flatten, groupTurns, tokenPoints } from '../src/renderer/sessions/view/transcript.js'
import { SessionParser } from '../src/main/sessions/SessionParser.js'

describe('parseCommand', () => {
  it('parses a slash-command record', () => {
    const cmd = parseCommand('<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>')
    expect(cmd).toMatchObject({ name: '/model', args: 'opus' })
  })

  it('parses a caveat-prefixed command record', () => {
    const cmd = parseCommand('<local-command-caveat>Caveat: local commands.</local-command-caveat>\n<command-name>/clear</command-name>')
    expect(cmd).toMatchObject({ name: '/clear', caveat: 'Caveat: local commands.' })
  })

  it('parses a standalone stdout record', () => {
    expect(parseCommand('<local-command-stdout>Set model to opus</local-command-stdout>').stdout).toBe('Set model to opus')
  })

  it('ignores prose that merely mentions a command tag mid-text', () => {
    expect(parseCommand('the separate `<local-command-stdout>` message stays headerless')).toBe(null)
    expect(parseCommand('we parse the <command-name> tag here')).toBe(null)
  })
})

describe('flatten — queued commands', () => {
  const queued = (attachment, uuid = 'q1') => ({ type: 'attachment', uuid, timestamp: '2026-07-30T00:41:09.674Z', attachment: { type: 'queued_command', ...attachment } })
  const assistant = { type: 'assistant', uuid: 'a1', timestamp: '2026-07-30T00:41:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }

  it('renders a human-queued prompt as a user turn, not an attachment', () => {
    const turns = flatten([assistant, queued({ prompt: 'exclude the mcp test', commandMode: 'prompt', origin: { kind: 'human' } })])
    expect(turns[1]).toMatchObject({ role: 'user', isMeta: false, queued: true, blocks: [{ type: 'text', text: 'exclude the mcp test' }] })
    expect(groupTurns(turns).map(g => g.kind)).toEqual(['assistant', 'user'])
  })

  it('renders older records with no origin as a user turn too', () => {
    expect(flatten([queued({ prompt: 'why?', commandMode: 'prompt' })])[0]).toMatchObject({ role: 'user', queued: true })
  })

  it('leaves harness- and agent-queued prompts as attachments', () => {
    const items = [
      queued({ prompt: '<task-notification>…</task-notification>', commandMode: 'task-notification' }, 'q1'),
      queued({ prompt: 'from a peer', commandMode: 'prompt', origin: { kind: 'peer', from: 'simplify' } }, 'q2'),
    ]
    const turns = flatten(items)
    expect(turns).toHaveLength(1) // consecutive attachments coalesce into one meta turn
    expect(turns[0].isMeta).toBe(true)
    expect(turns[0].blocks.map(b => b.type)).toEqual(['attachment', 'attachment'])
  })
})

// A queued command is logged when consumed but timestamped when typed, so readSession's
// sort moves it back before lines logged before it — running totals must survive that.
describe('token totals around a back-dated queued command', () => {
  const at = s => `2026-07-30T00:41:${String(s).padStart(2, '0')}.000Z`
  const usage = (input, output) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  const lines = [
    { type: 'user', uuid: 'u1', timestamp: at(0), message: { role: 'user', content: 'hi' } },
    { type: 'assistant', uuid: 'a1', timestamp: at(1), message: { id: 'm1', model: 'claude-opus-5', usage: usage(100, 10), content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } },
    { type: 'user', uuid: 'r1', timestamp: at(1), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { type: 'assistant', uuid: 'a2', timestamp: at(6), message: { id: 'm2', model: 'claude-opus-5', usage: usage(200, 20), content: [{ type: 'tool_use', id: 't2', name: 'Read', input: {} }] } },
    { type: 'user', uuid: 'r2', timestamp: at(6), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } },
    { type: 'attachment', uuid: 'q1', timestamp: at(3), attachment: { type: 'queued_command', prompt: 'wait, don\'t do that', commandMode: 'prompt', origin: { kind: 'human' } } },
    { type: 'assistant', uuid: 'a3', timestamp: at(9), message: { id: 'm3', model: 'claude-opus-5', usage: usage(300, 30), content: [{ type: 'thinking', thinking: '' }] } },
    { type: 'assistant', uuid: 'a4', timestamp: at(10), message: { id: 'm3', model: 'claude-opus-5', usage: usage(300, 30), content: [{ type: 'text', text: 'done' }] } },
  ]

  // What SessionsService.readSession hands the renderer: parsed in file order, then sorted by timestamp.
  const read = () => {
    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl' })
    const items = lines.map(l => structuredClone(l)).filter(l => parser.feed(l))
    return items.sort((a, b) => a._ts - b._ts)
  }

  it('never walks the running total backwards', () => {
    const totals = tokenPoints(groupTurns(flatten(read()))).filter(Boolean).map(p => p.total)
    expect(totals).toEqual([...totals].sort((a, b) => a - b))
    expect(new Set(totals).size).toBe(totals.length)
  })

  it('bills the queued prompt to the call that consumed it, not to the moment it was typed', () => {
    const groups = groupTurns(flatten(read()))
    const points = tokenPoints(groups)
    const i = groups.findIndex(g => g.turns.some(t => t.queued))
    expect(points[i]).toBe(null)
  })
})

describe('groupTurns — instruction runs', () => {
  const items = [{ type: 'user', uuid: 'u1', timestamp: '2026-07-24T18:07:31.000Z', message: { role: 'user', content: 'hi' } }]
  const instr = (timestamp, file_path) => ({ timestamp, file_path, content: 'x' })

  it('groups one request\'s instructions together', () => {
    const ts = '2026-07-24T18:07:30.336Z'
    const groups = groupTurns(flatten(items, [instr(ts, 'System Prompt'), instr(ts, 'System Tools'), instr(ts, 'CLAUDE.md')]))
    expect(groups.map(g => g.kind)).toEqual(['instruction', 'user'])
    expect(groups[0].turns).toHaveLength(3)
  })

  it('splits instructions of two back-to-back requests — their totals must not be summed', () => {
    const groups = groupTurns(flatten(items, [
      instr('2026-07-24T18:07:30.326Z', 'System Prompt'), // title generation
      instr('2026-07-24T18:07:30.336Z', 'System Prompt'), // the main loop, 10ms later
      instr('2026-07-24T18:07:30.336Z', 'System Tools'),
    ]))
    expect(groups.map(g => g.kind)).toEqual(['instruction', 'instruction', 'user'])
    expect(groups.map(g => g.turns.length)).toEqual([1, 2, 1])
  })
})
