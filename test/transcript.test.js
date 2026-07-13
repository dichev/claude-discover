import { describe, it, expect } from 'vitest'
import { parseCommand } from '../src/renderer/sessions/view/transcript.js'

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
