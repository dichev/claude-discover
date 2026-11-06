// src/main/sessions/McpTools.js: the MCP servers each turn had, from the transcript's requests
import { describe, it, expect } from 'vitest'
import { shape, request, resumed, deferred, status, use, result, feed } from './fixtures/mcp-records.js'

describe('McpTools', () => {
  it('lists the servers from the first request and wherever they change, again at each new process', () => {
    const tools = feed([
      shape('s1', ['Read', 'mcp__pycharm__run']),
      // the server's own name, where it announced instructions; a tool's spelling otherwise
      { type: 'attachment', timestamp: '2026-11-04T10:00:00.000Z', attachment: { type: 'mcp_instructions_delta', addedNames: ['claude.ai Docs'] } },
      deferred('2026-11-04T10:00:00.000Z', ['mcp__claude_ai_Docs__read']),
      request('2026-11-04T10:00:00.100Z', 's1'),
      request('2026-11-04T10:00:05.000Z', 's1'), // the same servers: no new turn
      deferred('2026-11-04T10:01:00.000Z', ['mcp__playwright__click']),
      request('2026-11-04T10:01:00.100Z', 's1'),
      deferred('2026-11-04T10:02:00.000Z', [], ['mcp__claude_ai_Docs__read']),
      request('2026-11-04T10:02:00.100Z', 's1'),
      resumed('2026-11-04T10:30:00.000Z', 's1'), // the same servers, but a new process loaded them again
      request('2026-11-05T09:00:00.000Z', 's1'), // unchanged, but the first of another period
    ])
    const turns = tools.turns()
    // the first (and each new process) lists them all, the others only what changed since
    expect(turns.map(t => [t.startedAt, t.change, t.servers.map(s => `${s.name} ${s.status}`)])).toEqual([
      ['2026-11-04T10:00:00.100Z', false, ['claude.ai Docs connected', 'pycharm connected']],
      ['2026-11-04T10:01:00.100Z', true, ['playwright connected']],
      ['2026-11-04T10:02:00.100Z', true, ['claude.ai Docs removed']],
      ['2026-11-04T10:30:00.000Z', false, ['playwright connected', 'pycharm connected']],
    ])
    expect(turns[0].servers[1]).toEqual({ name: 'pycharm', status: 'connected', readyWithin: null, error: null, toolCount: 1, groups: [], tools: [] })
    const nextDay = { start: Date.parse('2026-11-05T00:00:00Z'), end: Date.parse('2026-11-05T23:59:59Z') }
    expect(tools.turns(nextDay).map(t => [t.startedAt, t.change, t.servers.map(s => s.name)])).toEqual([['2026-11-05T09:00:00.000Z', false, ['playwright', 'pycharm']]])
  })

  it('lists the servers the transcript says failed, need a login or are still connecting, and when that changes', () => {
    const tools = feed([
      shape('s1', ['mcp__pycharm__run']),
      status('2026-11-04T10:00:00.000Z', {
        failedMcpServers: [{ name: 'browser', errorCode: 'CONNECTION_CLOSED', error: 'Connection closed' }],
        needsAuthMcpServers: ['claude.ai Notion'], pendingMcpServers: ['playwright'],
      }),
      resumed('2026-11-04T10:00:00.100Z', 's1'),
      status('2026-11-04T10:00:09.000Z', {
        addedNames: ['mcp__playwright__click'], failedMcpServers: [{ name: 'browser', errorCode: 'CONNECTION_CLOSED', error: 'Connection closed' }],
      }),
      request('2026-11-04T10:00:09.100Z', 's1'),
    ])
    const servers = turn => turn.servers.map(s => [s.name, s.status, s.error])
    const turns = tools.turns()
    expect(turns.map(t => t.change)).toEqual([false, true])
    expect(servers(turns[0])).toEqual([
      ['browser', 'failed', 'CONNECTION_CLOSED: Connection closed'], ['claude.ai Notion', 'needs-auth', null],
      ['playwright', 'pending', null], ['pycharm', 'connected', null],
    ])
    // playwright connected, Notion's announcement left it out
    expect(servers(turns[1])).toEqual([['playwright', 'connected', null], ['claude.ai Notion', 'removed', null]])
    // when it connected isn't logged: at most this long after the request that found it connecting
    expect(turns.map(t => t.servers.map(s => s.readyWithin))).toEqual([[null, null, null, null], [9000, null]])
  })

  it('counts each server\'s tools and lists its tool calls under its latest row, with their time and error', () => {
    const tools = feed([
      shape('s1', ['Read', 'mcp__pycharm__run', 'mcp__pycharm__lint', 'mcp__playwright__click']), // a loaded deferred tool is in both
      deferred('2026-11-04T10:00:00.000Z', ['mcp__playwright__click', 'mcp__playwright__snapshot']),
      resumed('2026-11-04T10:00:00.100Z', 's1'),
      use('2026-11-04T10:00:01.000Z', 't1', 'mcp__pycharm__run'),
      result('2026-11-04T10:00:01.250Z', 't1', false, 'ok'),
      deferred('2026-11-04T10:00:02.000Z', ['mcp__ide__diff']),
      request('2026-11-04T10:00:02.100Z', 's1'),
      use('2026-11-04T10:00:03.000Z', 't2', 'mcp__ide__diff'),
      result('2026-11-04T10:00:03.010Z', 't2', true, [{ type: 'text', text: 'no editor' }]),
      use('2026-11-04T10:00:04.000Z', 't3', 'mcp__playwright__click'), // no result yet
    ])
    const turns = tools.turns()
    expect(turns.map(t => t.servers.map(s => [s.name, s.toolCount, s.tools]))).toEqual([
      [['playwright', 2, [{ name: 'click', ms: null, error: null }]], ['pycharm', 2, [{ name: 'run', ms: 250, error: null }]]],
      [['ide', 1, [{ name: 'diff', ms: 10, error: 'no editor' }]]],
    ])
  })

  it('splits a server that mounts others by its tools\' name prefixes, but not one whose tools start with verbs', () => {
    const toolbox = [
      'meta_ads_get_insights', 'meta_ads_create_ad', 'meta_ads_pause', 'meta_ads_get_campaigns', 'meta_ads_save_plan',
      'clients_get_client', 'clients_add_task', 'clients_get_tasks', 'clients_send_offer', 'clients_check_link', 'clients_patch_client',
      'drive_files', 'drive_share_link', 'drive_trash_files', 'billing_refund', 'billing_money_state',
    ]
    const ide = ['get_file', 'get_symbol', 'list_files', 'search_text', 'search_symbol', 'open_file', 'build_project', 'lint_files', 'rename_symbol']
    const tools = feed([
      shape('s1', [...toolbox.map(t => `mcp__toolbox__${t}`), ...ide.map(t => `mcp__ide__${t}`)]),
      resumed('2026-11-04T10:00:00.100Z', 's1'),
    ])
    const [turn] = tools.turns()
    expect(turn.servers.map(s => [s.name, s.groups])).toEqual([
      ['ide', []],
      ['toolbox', [{ name: 'billing', toolCount: 2 }, { name: 'clients', toolCount: 6 }, { name: 'drive', toolCount: 3 }, { name: 'meta', toolCount: 5 }]],
    ])
  })
})
