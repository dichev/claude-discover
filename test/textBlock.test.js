import { describe, it, expect } from 'vitest'
import { fenceBlocks, parseCommand } from '../src/renderer/utils/textBlock.js'

describe('fenceBlocks', () => {
  it('wraps bare JSON objects in a json fence', () => {
    const out = fenceBlocks('Result: {"status": "ok", "count": 3}')
    expect(out).toContain('```json')
    expect(out).toContain('{"status": "ok", "count": 3}')
  })

  it('wraps bare Python dicts in a python fence', () => {
    const out = fenceBlocks("Data: {'name': 'Alice', 'age': 30}")
    expect(out).toContain('```python')
  })

  it('leaves JSON that is already fenced untouched (no double-wrap)', () => {
    const input = '```json\n{ "about": { "name": "" } }\n```'
    expect(fenceBlocks(input)).toBe(input)
  })

  it('does not re-wrap inside a fence but still wraps bare JSON outside it', () => {
    const input = 'Before {"a": 1}\n\n```json\n{ "b": 2 }\n```\n\nAfter {"c": 3}'
    const out = fenceBlocks(input)
    // The pre-fenced middle block is preserved verbatim, only once.
    expect(out.match(/```json\n\{ "b": 2 \}\n```/g)).toHaveLength(1)
    // The two bare objects each get their own fence.
    expect(out).toContain('"a": 1')
    expect(out).toContain('"c": 3')
  })

  it('treats an unclosed fence as fencing the rest of the text', () => {
    const input = '```json\n{ "a": 1 }'
    expect(fenceBlocks(input)).toBe(input)
  })

  it('wraps the whole object when it is followed by a CRLF line ending', () => {
    // Prose uses CRLF but the JSON body uses LF (real-world mixed endings).
    const input = '<schema>\r\n{\n  "about": {\n    "x": ""\n  }\n}\r\n</schema>'
    const out = fenceBlocks(input)
    // One fence around the whole object — not a fragment of an inner sub-object.
    expect(out.match(/```json/g)).toHaveLength(1)
    expect(out).toContain('"about"')
    // The outer braces are inside the fence, not stranded as bare text.
    expect(out).not.toMatch(/```json\n\{\n {4}"x"/)
  })

  it('returns non-strings and brace-free text unchanged', () => {
    expect(fenceBlocks(null)).toBe(null)
    expect(fenceBlocks('plain text')).toBe('plain text')
  })
})

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
