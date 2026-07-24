import { describe, it, expect } from 'vitest'
import { parseCommand, flatten, groupTurns } from '../src/renderer/sessions/view/transcript.js'

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
