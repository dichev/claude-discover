// src/main/sessions/McpDebugLog.js: the transcript's MCP blocks (McpTools), filled in from Claude Code's debug log
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { McpDebugLog, parseMcpLog } from '../src/main/sessions/McpDebugLog.js'
import { serverRow } from '../src/main/sessions/McpTools.js'
import { shape, request, resumed, status, use, result, feed } from './fixtures/mcp-records.js'

const dir = path.join(import.meta.dirname, 'fixtures', 'claude', 'debug')

describe('parseMcpLog', () => {
  const turns = parseMcpLog(fs.readFileSync(path.join(dir, 'sess-mcp.txt'), 'utf8'))

  it('splits the log into a turn per process with each server\'s transport, outcome, time and tool calls', () => {
    expect(turns.map(t => [t.startedAt, t.servers.length])).toEqual([['2026-11-04T21:33:11.410Z', 2], ['2026-11-05T09:00:00.000Z', 6], ['2026-11-05T10:00:00.010Z', 0]])
    expect(turns[0].servers).toEqual([
      serverRow({ name: 'gateway_echo', transport: 'http', status: 'connected', ms: 139, tools: [{ name: 'whoami', ms: 9, error: null }, { name: 'slow', ms: null, error: null }] }),
      serverRow({ name: 'stdio_echo', transport: 'stdio', status: 'connected', ms: 164 }),
    ])
    expect(turns[1].servers.map(s => [s.name, s.transport, s.status, s.ms])).toEqual([
      ['gateway_echo', 'http', 'connected', 9],
      ['stdio_echo', 'stdio', 'connected', 166],
      ['broken', 'stdio', 'failed', 59],
      ['ide', 'ws-ide', 'connected', 43], // transports beyond stdio/http: the IDE's websocket, claude.ai connectors
      ['claude.ai Gmail', 'claudeai-proxy', 'connected', 1],
      ['claude-artifacts', 'http', 'failed', 373],
    ])
  })

  it('reads a failure whose time carries a note, and a failed tool call, a multi-line one logged as a JSON string', () => {
    const server = name => turns[1].servers.find(s => s.name === name)
    expect(server('claude-artifacts').error).toBe('404: Error POSTing to endpoint: not found')
    expect(server('ide').tools).toEqual([{ name: 'closeAllDiffTabs', ms: 0, error: 'Tool not found: closeAllDiffTabs' }])
    expect(server('stdio_echo').tools).toEqual([{ name: 'crash', ms: 0, error: '### Error\nError: it broke' }])
  })

  it('keeps a failure\'s reason and its stderr, multi-line ones included', () => {
    const broken = turns[1].servers.find(s => s.name === 'broken')
    expect(broken.error).toBe('CONNECTION_CLOSED: Connection closed')
    expect(broken.stderr).toEqual([
      'Traceback (most recent call last):',
      '  File "server.py", line 1, in <module>',
      'ModuleNotFoundError: No module named \'mcp\'',
    ])
  })

  it('without the process line, starts a turn at the first server; skips the lines it doesn\'t recognize; reads CRLF the same', () => {
    const log = [
      'garbage',
      '2026-11-04T21:33:11.000Z [DEBUG] MCP server "x": Successfully connected (transport: stdio) in 5ms', // before any start
      '2026-11-04T21:33:11.001Z [DEBUG] MCP server "x": Starting connection with timeout of 30000ms',
      '2026-11-04T21:33:11.002Z [WARN] MCP server "x": something new',
      '2026-11-04T21:33:11.003Z [DEBUG] MCP server "x": Successfully connected (transport: stdio) in 12ms',
    ].join('\r\n')
    expect(parseMcpLog(log)).toEqual([{ startedAt: '2026-11-04T21:33:11.001Z', servers: [serverRow({ name: 'x', transport: 'stdio', status: 'connected', ms: 12 })] }])
  })
})

describe('McpDebugLog', () => {
  const transcript = () => feed([
    shape('s1', ['mcp__gateway_echo__whoami', 'mcp__teamflows__wait']),
    shape('s2', ['mcp__gateway_echo__whoami', 'mcp__stdio_echo__crash', 'mcp__teamflows__wait']),
    shape('s3', ['mcp__gateway_echo__whoami', 'mcp__stdio_echo__crash', 'mcp__ide__diff', 'mcp__claude_ai_Gmail__send', 'mcp__teamflows__wait']),
    status('2026-11-04T21:33:12.000Z', { pendingMcpServers: ['stdio_echo'] }),
    resumed('2026-11-04T21:33:13.000Z', 's1'), // process 1's first request
    use('2026-11-04T21:33:13.600Z', 't1', 'mcp__gateway_echo__whoami'),
    result('2026-11-04T21:33:13.800Z', 't1', false, 'me'),
    status('2026-11-04T21:33:13.900Z', {}),
    request('2026-11-04T21:33:14.000Z', 's2'), // stdio_echo connected since
    status('2026-11-05T09:00:01.900Z', { failedMcpServers: [{ name: 'broken', errorCode: 'CONNECTION_CLOSED', error: 'Connection closed' }] }),
    resumed('2026-11-05T09:00:02.000Z', 's3'), // process 2's
    use('2026-11-05T09:00:02.900Z', 't2', 'mcp__stdio_echo__crash'),
    result('2026-11-05T09:00:03.100Z', 't2', true, 'Error: it broke'),
    shape('s4', ['mcp__teamflows__wait']),
    status('2026-11-05T10:00:00.900Z', {}),
    resumed('2026-11-05T10:00:01.000Z', 's4'), // process 3's: an SDK server only, so it logged none
    resumed('2026-11-06T08:00:00.000Z', 's1'), // a process run without debug
  ])
  const filled = async (sessionId, range = null) => {
    const tools = transcript()
    const turns = tools.turns(range)
    return { debugLog: await new McpDebugLog(sessionId, { dir }).fillIn(turns, tools.processStarts()), turns }
  }

  it('fills in the transcript\'s blocks from the logged process that sent their requests', async () => {
    const { debugLog, turns } = await filled('sess-mcp')
    expect(debugLog).toBe(path.join(dir, 'sess-mcp.txt'))
    const rows = turn => turn.servers.map(s => [s.name, s.transport, s.status, s.ms, s.readyWithin])
    expect(turns.map(t => [t.startedAt, t.debug, t.change])).toEqual([
      ['2026-11-04T21:33:13.000Z', true, false], ['2026-11-04T21:33:14.000Z', true, true], ['2026-11-05T09:00:02.000Z', true, false],
      ['2026-11-05T10:00:01.000Z', true, false], ['2026-11-06T08:00:00.000Z', false, false],
    ])
    // its connect time lands on the row it connected in; an SDK server, which the log never names, runs in-process
    expect(rows(turns[0])).toEqual([['gateway_echo', 'http', 'connected', 139, null], ['stdio_echo', 'stdio', 'pending', null, null], ['teamflows', 'sdk', 'connected', null, null]])
    expect(rows(turns[1])).toEqual([['stdio_echo', 'stdio', 'connected', 164, null]])
    expect(rows(turns[2])).toEqual([
      ['broken', 'stdio', 'failed', 59, null], ['claude.ai Gmail', 'claudeai-proxy', 'connected', 1, null], ['gateway_echo', 'http', 'connected', 9, null],
      ['ide', 'ws-ide', 'connected', 43, null], ['stdio_echo', 'stdio', 'connected', 166, null], ['teamflows', 'sdk', 'connected', null, null],
      ['claude-artifacts', 'http', 'failed', 373, null], // only the log has it
    ])
    expect(turns[2].servers[0].stderr).toHaveLength(3)
    expect(rows(turns[3])).toEqual([['teamflows', 'sdk', 'connected', null, null]])
    expect(rows(turns[4]).map(r => r[1])).toEqual([null, null])
  })

  it('gives the transcript\'s tool calls the server\'s own time, and adds the calls only the log has', async () => {
    const { turns } = await filled('sess-mcp')
    const tools = (turn, name) => turn.servers.find(s => s.name === name).tools
    expect(tools(turns[0], 'gateway_echo')).toEqual([{ name: 'whoami', ms: 9, error: null }, { name: 'slow', ms: null, error: null }])
    expect(tools(turns[2], 'stdio_echo')).toEqual([{ name: 'crash', ms: 0, error: '### Error\nError: it broke' }])
    expect(tools(turns[2], 'ide')).toEqual([{ name: 'closeAllDiffTabs', ms: 0, error: 'Tool not found: closeAllDiffTabs' }]) // Claude Code's own
  })

  it('keeps only the blocks started in the period, filled in all the same', async () => {
    const range = { start: Date.parse('2026-11-05T00:00:00Z'), end: Date.parse('2026-11-05T23:59:59Z') }
    const { turns } = await filled('sess-mcp', range)
    expect(turns.map(t => [t.startedAt, t.debug])).toEqual([['2026-11-05T09:00:02.000Z', true], ['2026-11-05T10:00:01.000Z', true]])
  })

  it('leaves the blocks as the transcript has them where the session has no debug log', async () => {
    const { debugLog, turns } = await filled('no-such-session')
    expect(debugLog).toBeNull()
    expect(turns).toEqual(transcript().turns())
    expect(turns.some(t => t.debug)).toBe(false)
  })

  it('tells whether the session has a debug log, for the session list to mark it', async () => {
    expect(await new McpDebugLog('sess-mcp', { dir }).exists()).toBe(true)
    expect(await new McpDebugLog('no-such-session', { dir }).exists()).toBe(false)
  })
})
