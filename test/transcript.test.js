import { describe, it, expect } from 'vitest'
import { parseCommand, flatten, groupTurns, groupInstructions, tokenPoints, compactTitle, persistedOutput } from '../src/renderer/sessions/view/transcript.js'
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

describe('flatten — encrypted thinking', () => {
  const assistant = content => ({ type: 'assistant', uuid: 'a1', timestamp: '2026-09-21T09:00:00.000Z', message: { role: 'assistant', content } })

  it('keeps a signature-only thinking block as one redacted marker', () => {
    const turns = flatten([assistant([{ type: 'thinking', thinking: '', signature: 'sig==' }, { type: 'text', text: 'ok' }])])
    expect(turns[0].blocks).toEqual([{ type: 'thinking', redacted: 1 }, { type: 'text', text: 'ok' }])
  })

  it('collapses a run of them into a single counted marker', () => {
    const turns = flatten([assistant([{ type: 'thinking', thinking: '' }, { type: 'thinking', thinking: '  ' }, { type: 'thinking', thinking: 'out loud' }])])
    expect(turns[0].blocks).toEqual([{ type: 'thinking', redacted: 2 }, { type: 'thinking', thinking: 'out loud' }])
  })
})

describe('flatten — skill companion records', () => {
  const call   = { type: 'assistant', uuid: 'a1', timestamp: '2026-09-22T00:02:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Skill', input: { skill: 'claude-api' } }] } }
  const result = { type: 'user', uuid: 'r1', timestamp: '2026-09-22T00:02:01.385Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'Launching skill: claude-api' }] } }
  const body   = { type: 'user', uuid: 'c1', timestamp: '2026-09-22T00:02:01.383Z', isMeta: true, turnCompanion: true, sourceToolUseID: 'tu1', message: { role: 'user', content: [{ type: 'text', text: '# Building with Claude' }] } }

  it('counts a Skill call among tool calls and as a skill', () => {
    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl' })
    for (const l of [call, result, body]) parser.feed(structuredClone(l))
    expect(parser.meta).toMatchObject({ toolCalls: 1, skillCalls: 1 })
  })

  it('folds the skill body into the Skill call result instead of a meta note', () => {
    const turns = flatten([call, result, body])
    expect(turns).toHaveLength(1)
    expect(turns[0].blocks[0].result.content).toEqual([{ type: 'text', text: 'Launching skill: claude-api' }, { type: 'text', text: '# Building with Claude' }])
  })

  it('folds a slash-command skill body into the command turn', () => {
    const cmd  = { type: 'user', uuid: 'u1', timestamp: '2026-09-23T18:50:38.018Z', message: { role: 'user', content: '<command-message>hire</command-message>\n<command-name>/hire</command-name>' } }
    const body = { type: 'user', uuid: 'c2', parentUuid: 'u1', timestamp: '2026-09-23T18:50:38.018Z', isMeta: true, turnCompanion: true, message: { role: 'user', content: [{ type: 'text', text: '# Writing a job' }] } }
    const turns = flatten([cmd, body])
    expect(turns).toHaveLength(1)
    expect(turns[0].blocks[1]).toEqual({ type: 'skill', name: 'hire', text: '# Writing a job' })

    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl' })
    for (const l of [cmd, body]) parser.feed(structuredClone(l))
    expect(parser.meta).toMatchObject({ toolCalls: 0, skillCalls: 1, firstUserPrompt: null })
  })

  it('keeps a companion after an assistant turn as a System note', () => {
    const reply = { type: 'assistant', uuid: 'a2', timestamp: '2026-09-28T00:53:26.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'sig==' }] } }
    const nudge = { type: 'user', uuid: 'c3', parentUuid: 'a2', timestamp: '2026-09-28T00:53:26.679Z', isMeta: true, turnCompanion: true, message: { role: 'user', content: '[Your previous response had no visible output. Please continue and produce a user-visible response.]' } }
    const turns = flatten([reply, nudge])
    expect(turns).toHaveLength(2)
    expect(turns[1]).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: nudge.message.content }] })

    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl' })
    for (const l of [reply, nudge]) parser.feed(structuredClone(l))
    expect(parser.meta).toMatchObject({ skillCalls: 0, firstUserPrompt: null })
  })
})

describe('flatten — what Claude Code writes in the model\'s name', () => {
  const synthetic = (uuid, text, extra) => ({ type: 'assistant', uuid, timestamp: '2026-09-28T20:51:19.685Z', ...extra, message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text }] } })

  it('shows the line closing a turn a hook stopped as a System notice beside its meta prompt, not a Claude reply', () => {
    const resume = { type: 'user', uuid: 'm1', timestamp: '2026-09-28T20:51:19.685Z', isMeta: true, message: { role: 'user', content: 'Continue from where you left off.' } }
    const groups = groupTurns(flatten([resume, synthetic('s1', 'No response requested.')]))
    expect(groups.map(g => g.kind)).toEqual(['system'])
    expect(groups[0].turns[1]).toMatchObject({ role: 'system', blocks: [{ type: 'system', title: 'No response requested.', level: null }] })
  })

  it('shows an API error as an error notice', () => {
    const [turn] = flatten([synthetic('s2', 'API Error: 529 Overloaded', { isApiErrorMessage: true })])
    expect(turn.blocks).toEqual([{ type: 'system', title: 'API Error: 529 Overloaded', level: 'error' }])
  })
})

describe('SessionParser — effort', () => {
  it('collects distinct effort levels, preferring perTurnEffort and falling back to effort', () => {
    const reply = (id, fields) => ({ type: 'assistant', uuid: id, timestamp: '2026-09-28T00:00:00.000Z', ...fields, message: { id, role: 'assistant', model: 'claude-opus-5-5', content: [] } })
    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl' })
    const lines = [
      reply('a1', { effort: 'high' }),
      reply('a2', { effort: 'high', perTurnEffort: null }),
      reply('a3', { effort: 'high', perTurnEffort: 'xhigh' }),
      reply('a4', {}),
    ]
    for (const l of lines) parser.feed(l)
    expect(parser.meta.efforts).toEqual(['high', 'xhigh'])
  })
})

describe('SessionParser — continuesFrom / continuesTo', () => {
  const user = (uuid, timestamp) => ({ type: 'user', uuid, timestamp, message: { role: 'user', content: 'hi' } })
  const lines = [user('u1', '2026-09-25T10:00:00.000Z'), user('u2', '2026-09-26T14:32:00.000Z'), user('u3', '2026-09-28T09:00:00.000Z')]
  const range = { start: Date.parse('2026-09-28T00:00:00.000Z'), end: Date.parse('2026-09-28T23:59:59.999Z') }

  it('records the latest activity before the period', () => {
    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl', range })
    for (const l of lines) parser.feed(l)
    expect(parser.meta.continuesFrom).toBe(Date.parse('2026-09-26T14:32:00.000Z'))
  })

  it('records the earliest activity after the period', () => {
    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl', range: { start: Date.parse('2026-09-25T00:00:00.000Z'), end: Date.parse('2026-09-25T23:59:59.999Z') } })
    for (const l of lines) parser.feed(l)
    expect(parser.meta.continuesTo).toBe(Date.parse('2026-09-26T14:32:00.000Z'))
  })

  it('stays null for a whole-file parse', () => {
    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl' })
    for (const l of lines) parser.feed(l)
    expect(parser.meta.continuesFrom).toBeNull()
    expect(parser.meta.continuesTo).toBeNull()
  })
})

describe('flatten — tool results', () => {
  it('keeps a result whose call lies outside the loaded period', () => {
    const result = { type: 'user', uuid: 'r1', timestamp: '2026-09-23T00:00:05.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu0', content: 'late' }] } }
    expect(flatten([result])).toMatchObject([{ role: 'tool', blocks: [{ type: 'tool_result', content: 'late' }] }])
  })
})

describe('flatten — system records', () => {
  const ts = '2026-09-23T00:00:00.000Z'
  const reply = { type: 'assistant', uuid: 'a1', timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }

  it('shows the printed text as the note body', () => {
    const recap = { type: 'system', subtype: 'away_summary', uuid: 's1', timestamp: ts, level: 'info', content: 'You asked to…' }
    expect(flatten([recap])[0].blocks).toEqual([{ type: 'system', title: 'Away summary', body: 'You asked to…', level: null }])
  })

  it('shows a notice with no text as its payload, without the envelope', () => {
    const err = { type: 'system', subtype: 'api_error', uuid: 's1', cwd: 'D:\\app', timestamp: ts, level: 'error', error: { formatted: 'Unable to connect to API (ECONNRESET)' }, retryAttempt: 1 }
    expect(flatten([err])[0].blocks).toEqual([{ type: 'system', title: 'API error', body: JSON.stringify({ error: err.error, retryAttempt: 1 }, null, 2), level: 'error' }])
  })

  it('shows a notice after a finished reply as a System row', () => {
    const hooks = { type: 'system', subtype: 'stop_hook_summary', uuid: 's1', timestamp: ts, hookCount: 0 }
    expect(groupTurns(flatten([reply, hooks])).map(g => g.kind)).toEqual(['assistant', 'system'])
  })

  it('skips the CLI\'s turn timing', () => {
    expect(flatten([{ type: 'system', subtype: 'turn_duration', uuid: 's1', timestamp: ts, durationMs: 3550 }])).toEqual([])
  })

  it('keeps a tagless local command as a plain note', () => {
    const exit = { type: 'system', subtype: 'local_command', uuid: 's1', timestamp: ts, content: '/exit' }
    expect(flatten([exit])[0].blocks[0]).toMatchObject({ type: 'system', title: 'Local command', body: '/exit' })
  })
})

describe('groupTurns — System rows', () => {
  const at = s => `2026-09-28T10:00:${String(s).padStart(2, '0')}.000Z`
  const att = (uuid, s, type) => ({ type: 'attachment', uuid, timestamp: at(s), attachment: { type } })
  const prompt = { type: 'user', uuid: 'u1', timestamp: at(1), message: { role: 'user', content: 'fix it' } }
  const call   = { type: 'assistant', uuid: 'a1', timestamp: at(3), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: {} }] } }
  const result = { type: 'user', uuid: 'r1', timestamp: at(4), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } }
  const reply  = { type: 'assistant', uuid: 'a2', timestamp: at(6), message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed.' }] } }

  it('splits Claude Code\'s context off the prompt, keeping the user\'s own with it', () => {
    const groups = groupTurns(flatten([att('i1', 0, 'selected_lines_in_ide'), prompt, att('d1', 2, 'date'), att('f1', 2, 'file'), att('e1', 2, 'environment')]))
    expect(groups.map(g => [g.kind, g.turns.flatMap(t => t.blocks.map(b => b.attachment?.type ?? b.text))])).toEqual([
      ['user', ['selected_lines_in_ide', 'fix it', 'file']],
      ['system', ['date', 'environment']],
    ])
  })

  it('folds what Claude Code injects mid-cycle into Claude\'s card rather than splitting it', () => {
    const groups = groupTurns(flatten([prompt, call, result, att('t1', 5, 'total_tokens_reminder'), reply]))
    expect(groups.map(g => g.kind)).toEqual(['user', 'assistant'])
    expect(groups[1].turns.map(t => t.role)).toEqual(['assistant', 'system', 'assistant'])
  })

  it('gives System prompting Claude its own row, even mid-cycle', () => {
    const resume = { type: 'user', uuid: 'm1', timestamp: at(5), isMeta: true, message: { role: 'user', content: 'Continue from where you left off.' } }
    expect(groupTurns(flatten([prompt, call, result, resume, reply])).map(g => g.kind)).toEqual(['user', 'assistant', 'system', 'assistant'])
  })
})

describe('flatten — state changes', () => {
  const msg = (uuid, cwd) => ({ type: 'user', uuid, cwd, timestamp: '2026-07-24T00:48:55.000Z', message: { role: 'user', content: 'hi' } })
  const titles = items => flatten(items).flatMap(t => t.blocks).filter(b => b.type === 'system').map(b => b.title)

  it('notes a permission mode only when it changes', () => {
    const mode = m => ({ type: 'permission-mode', permissionMode: m })
    expect(titles([mode('default'), msg('u1'), mode('default'), mode('auto'), mode('auto')])).toEqual(['Permission mode → auto'])
  })

  it('notes a working directory change before the record that made it', () => {
    const turns = flatten([msg('u1', 'D:\\app'), msg('u2', 'D:\\app'), msg('u3', 'D:\\app\\.claude\\worktrees\\x')])
    expect(turns.map(t => t.uuid)).toEqual(['u1', 'u2', 'state-2', 'u3'])
    expect(turns[2].blocks[0].title).toBe('Working directory → D:\\app\\.claude\\worktrees\\x')
  })

  it('links a published artifact once', () => {
    const link = { type: 'frame-link', frameUrl: 'https://claude.ai/artifact/a1', title: 'Notes', timestamp: '2026-09-16T19:06:42.109Z' }
    const notes = flatten([link, { ...link }]).flatMap(t => t.blocks)
    expect(notes).toEqual([{ type: 'system', title: 'Artifact: Notes', url: 'https://claude.ai/artifact/a1' }])
  })
})

describe('flatten — compaction', () => {
  // As readSession delivers them: sorted by timestamp, so the summary lands just before its boundary
  const summary  = { type: 'user', uuid: 'u1', parentUuid: 'b1', timestamp: '2026-06-12T02:58:34.764Z', isCompactSummary: true, _tokenDelta: 9000, _tokenTotal: 200000, message: { role: 'user', content: 'This session is being continued…' } }
  const boundary = { type: 'system', subtype: 'compact_boundary', uuid: 'b1', timestamp: '2026-06-12T02:58:34.773Z', content: 'Conversation compacted', compactMetadata: { trigger: 'manual', preTokens: 188391 } }

  it('joins the boundary and its summary into one compact group, not a user message', () => {
    const turns = flatten([summary, boundary])
    expect(turns).toMatchObject([{ role: 'compact', tokenTotal: 200000, blocks: [{ type: 'compact', trigger: 'manual', preTokens: 188391, summary: 'This session is being continued…' }] }])
    expect(groupTurns(turns).map(g => g.kind)).toEqual(['compact'])
    expect(compactTitle(turns[0].blocks[0])).toBe('Conversation compacted (manual · 188.4k tokens before)')
  })

  it('never takes the summary as the first prompt', () => {
    const prompt = { type: 'user', uuid: 'u2', timestamp: '2026-06-12T02:59:00.000Z', message: { role: 'user', content: 'next task' } }
    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl' })
    for (const l of [summary, boundary, prompt]) parser.feed(structuredClone(l))
    expect(parser.meta.firstUserPrompt).toBe('next task')
  })
})

describe('partial compaction re-logging the preserved messages', () => {
  const call = { type: 'assistant', uuid: 'a1', timestamp: '2026-07-16T02:03:10.542Z', message: { id: 'm1', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: {} }], usage: { input_tokens: 131, output_tokens: 814 } } }
  const copy = { ...call, parentUuid: 'x', message: { ...call.message, usage: { input_tokens: 0, output_tokens: 0 } } }

  it('counts and shows each record once, but still hands the copy to readSession', () => {
    const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl' })
    const items  = [call, copy].map(l => structuredClone(l))
    expect(items.map(l => parser.feed(l))).toEqual([true, true])
    expect(parser.meta).toMatchObject({ messageCount: 1, toolCalls: 1, tokens: { input: 131, output: 814 } })
    expect(flatten(items)).toMatchObject([{ uuid: 'a1', usage: { output_tokens: 814 } }])
  })
})

describe('persistedOutput', () => {
  it('links a saved output relative to the transcript dir, whatever OS wrote it', () => {
    const win = '<persisted-output>\nOutput too large (34.4KB). Full output saved to: C:\\Users\\me\\.claude\\projects\\D--app\\s1\\tool-results\\b3.txt\n\nPreview (first 2KB):\n…'
    const wsl = '<persisted-output>\nOutput too large (41.5KB). Full output saved to: /home/me/.claude/projects/-home-app/s1/tool-results/toolu_1.txt\n\nPreview'
    expect(persistedOutput(win)).toEqual({ path: 'C:\\Users\\me\\.claude\\projects\\D--app\\s1\\tool-results\\b3.txt', href: 's1/tool-results/b3.txt' })
    expect(persistedOutput(wsl).href).toBe('s1/tool-results/toolu_1.txt')
  })

  it('ignores output that merely mentions the phrase', () => {
    expect(persistedOutput('grep hit: Full output saved to: /etc/passwd')).toBeNull()
  })
})

describe('flatten — structured output', () => {
  it('drops the attachment echoing a StructuredOutput call', () => {
    const call = { type: 'assistant', uuid: 'a1', timestamp: '2026-09-23T00:00:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'StructuredOutput', input: { description: 'x' } }] } }
    const echo = { type: 'attachment', uuid: 'e1', timestamp: '2026-09-23T00:00:00.001Z', attachment: { type: 'structured_output', data: { description: 'x' }, toolUseID: 'tu1' } }
    expect(flatten([call, echo])).toHaveLength(1)
  })
})

describe('flatten — queued commands', () => {
  const queued = (attachment, uuid = 'q1') => ({ type: 'attachment', uuid, timestamp: '2026-07-30T00:41:09.674Z', attachment: { type: 'queued_command', ...attachment } })
  const assistant = { type: 'assistant', uuid: 'a1', timestamp: '2026-07-30T00:41:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }

  it('renders a human-queued prompt as a user turn, not an attachment', () => {
    const turns = flatten([assistant, queued({ prompt: 'exclude the mcp test', commandMode: 'prompt', origin: { kind: 'human' } })])
    expect(turns[1]).toMatchObject({ role: 'user', queued: true, blocks: [{ type: 'text', text: 'exclude the mcp test' }] })
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
    expect(turns[0].role).toBe('system')
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

describe('groupTurns — the instruction block', () => {
  const items = [
    { type: 'user', uuid: 'u1', timestamp: '2026-07-24T18:07:31.000Z', message: { role: 'user', content: 'hi' } },
    { type: 'user', uuid: 'u2', timestamp: '2026-07-24T18:08:31.000Z', message: { role: 'user', content: 'more' } },
  ]
  const instr = (timestamp, file_path, source) => ({ timestamp, file_path, source, content: 'x' })

  it('folds every request\'s instructions into one block above the first message', () => {
    const groups = groupTurns(flatten(items, [
      instr('2026-07-24T18:07:30.326Z', 'System Prompt', 'system'), // title generation
      instr('2026-07-24T18:07:30.336Z', 'System Prompt', 'system'), // the main loop, 10ms later
      instr('2026-07-24T18:07:30.336Z', 'System Tools', 'tools'),
      instr('2026-07-24T18:08:30.336Z', 'MCP Tools', 'tools'), // a deferred tool loaded by the second request
    ]))
    expect(groups.map(g => g.kind)).toEqual(['instruction', 'user', 'user'])
    expect(groups[0].turns).toHaveLength(1)
    expect(groups[0].turns[0].blocks.map(b => b.it.file_path)).toEqual(['System Prompt', 'System Prompt', 'System Tools', 'MCP Tools'])
  })

  it('groups the block\'s strips by source, in request order, skipping empty sources', () => {
    const strips = [instr('t', 'CLAUDE.md', 'message'), instr('t', 'System Tools', 'tools'), instr('t', 'System Prompt', 'system'), instr('t', 'MCP Tools', 'tools')]
    expect(groupInstructions(strips).map(([label, list]) => [label, list.map(it => it.file_path)])).toEqual([
      ['system prompt', ['System Prompt']],
      ['tools', ['System Tools', 'MCP Tools']],
      ['user message', ['CLAUDE.md']],
    ])
  })
})
