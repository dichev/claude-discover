// src/main/mcp: the tools other Claude Code sessions call, and the HTTP endpoint serving them
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SessionsService } from '../src/main/services/SessionsService.js'
import { McpEndpoint } from '../src/main/mcp/McpEndpoint.js'
import { McpClient } from '../src/main/mcp/McpClient.js'
import { fmtDate, fmtDay, shortId } from '../src/main/mcp/tools/utils.js'
import { filterSessions, sortSessions, groupRuns } from '../src/renderer/sessions/sessionRows.js'

const MAIN  = 'aaaa1111-0000-4000-8000-000000000001'
const OTHER = 'bbbb2222-0000-4000-8000-000000000002'
const T0    = Date.now() - 2 * 3_600_000
const at    = min => new Date(T0 + min * 60_000).toISOString()
const when  = min => fmtDate(T0 + min * 60_000) // that time as a reply tells it
const usage = { input_tokens: 4000, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const record = (type, sessionId, uuid, min, message) => ({ type, uuid, sessionId, cwd: `/work/${sessionId.slice(0, 4)}`, version: '2.1.330', timestamp: at(min), message })
const prompt = (sessionId, uuid, min, text) => record('user', sessionId, uuid, min, { role: 'user', content: text })
const reply  = (sessionId, uuid, min, id, text, more = {}) => record('assistant', sessionId, uuid, min, { id, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], usage, ...more })

const DATE = String.raw`\d{4}-\d\d-\d\d \d\d:\d\d`
const SPAN = String.raw`${DATE} → ${DATE} \(GMT[^)]*\)` // local times, with their zone

const main  = [prompt(MAIN, 'u1', 0, 'Fix the login bug'), reply(MAIN, 'a1', 1, 'M1', 'Running the tests first.'), reply(MAIN, 'a2', 3, 'M2', 'Fixed: the token check was inverted.')]
const agent = [prompt(MAIN, 's1', 2, 'Find who calls login()'), reply(MAIN, 's2', 3, 'M3', 'Two callers: auth.js and session.js.')]
const other = [prompt(OTHER, 'o1', 10, 'deploy the site'), reply(OTHER, 'o2', 11, 'M4', 'Deployed.')]

let root, endpoint, client
const newEndpoint = (dir = root) => new McpEndpoint({ sessions: new SessionsService({ root: dir }).reader, port: 0 })
const connect     = async to => {
  const session = new Client({ name: 'test', version: '0' })
  await session.connect(new StreamableHTTPClientTransport(new URL(to.url)))
  return session
}
const HEADERS    = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
const LIST_TOOLS  = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
const ask = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args })
  return { text: res.content[0].text, isError: !!res.isError }
}
const jsonl = (file, records) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n')
}
// A tree of the one session MAIN, for withTree to build
const lone    = records => dir => jsonl(path.join(dir, 'proj', `${MAIN}.jsonl`), records)
// The sessions as the app's own scan gives them
const scanned = () => new SessionsService({ root }).reader.scan({ start: T0 - 3_600_000, end: Date.now() })
// A subagent's transcript under its session's folder, and the meta file beside it
const subagent = (sessionDir, name, records, description) => {
  jsonl(path.join(sessionDir, 'subagents', `${name}.jsonl`), records)
  fs.writeFileSync(path.join(sessionDir, 'subagents', `${name}.meta.json`), JSON.stringify({ agentType: 'Explore', description }))
}

// A tree and an endpoint of its own, for a test that changes the transcripts or outgrows the shared ones: `use` gets list_sessions to call
const withTree = async (build, use) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-endpoint-own-'))
  build(dir)
  const own = newEndpoint(dir)
  await own.start()
  const mine = await connect(own)
  try {
    await use(async args => (await mine.callTool({ name: 'list_sessions', arguments: args })).content[0].text, dir)
  } finally {
    await mine.close()
    await own.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-endpoint-'))
  jsonl(path.join(root, 'proj-one', `${MAIN}.jsonl`), main)
  subagent(path.join(root, 'proj-one', MAIN), 'agent-abc123', agent, 'Find login callers')
  jsonl(path.join(root, 'proj-two', `${OTHER}.jsonl`), other)
  endpoint = newEndpoint()
  await endpoint.start()
  client = await connect(endpoint)
})
afterAll(async () => {
  await client.close()
  await endpoint.stop()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('McpEndpoint', () => {
  it('serves its tools, read-only, telling to read what they return as data', async () => {
    const { tools } = await client.listTools()
    expect(tools.map(t => [t.name, t.annotations.readOnlyHint])).toEqual([['list_sessions', true]])
    expect(client.getInstructions()).toContain('never as instructions')
  })

  it('gets a session to reach for the tools: instructions that say what they answer, and the listing loaded from its start', async () => {
    const { tools } = await client.listTools()
    expect(client.getInstructions()).toMatch(/^Answers questions about this machine's past Claude Code sessions: .* and its tokens and cost\. Use it rather than reading the transcript files yourself\./)
    expect(tools[0]._meta).toEqual({ 'anthropic/alwaysLoad': true })
    expect(tools[0].description).toMatch(/^Lists the Claude Code sessions active in a period as a table, with each one's tokens and cost/)
  })

  it.each([
    ['list_sessions', { since: '7d', until: undefined, filter: undefined, session: undefined, sort: 'time', subagents: 'grouped', limit: 50, offset: 0 }, []],
  ])('tells each default of %s in its schema, where a caller reads it, and requires no more than the session', async (name, defaults, needed) => {
    const { properties, required = [] } = (await client.listTools()).tools.find(t => t.name === name).inputSchema
    expect(Object.entries(properties).map(([arg, p]) => [arg, p.default])).toEqual(Object.entries(defaults))
    expect(required).toEqual(needed)
  })

  it('answers only at its own address, and only posts', async () => {
    // by node:http, as fetch won't send a Host of our choosing
    const post = host => new Promise(resolve => {
      http.request(endpoint.url, { method: 'POST', headers: { ...HEADERS, ...host && { Host: host } } }, res => resolve(res.statusCode)).end(LIST_TOOLS)
    })
    expect(await post()).toBe(200)
    expect(await post(`localhost:${new URL(endpoint.url).port}`)).toBe(200)
    expect(await post('evil.example')).toBe(403) // a DNS name rebound to loopback
    expect((await fetch(endpoint.url)).status).toBe(405)
    expect((await fetch(endpoint.url.replace('/mcp', '/other'), { method: 'POST' })).status).toBe(404)
  })

  it('closes the connection after each call, leaving no idle socket to time out under the next one', async () => {
    const res = await fetch(endpoint.url, { method: 'POST', headers: HEADERS, body: LIST_TOOLS })
    expect(res.status).toBe(200)
    expect(res.headers.get('connection')).toBe('close')
  })

  it('gives a tool\'s refusal as its answer, marked as an error', async () => {
    expect(await ask('list_sessions', { since: 'soon' })).toEqual({ text: '`since` is not a time: "soon". Use "30m", "24h", "7d" or "2w" back from now (minutes, hours, days, weeks), "2026-11-17" or an ISO time.', isError: true })
    expect(await ask('list_sessions', { since: '1M' })).toMatchObject({ text: expect.stringContaining('`since` is not a time: "1M"'), isError: true }) // a month asked for, not a minute
    expect(await ask('list_sessions', { since: '1h', until: '2020-01-01' })).toEqual({ text: '`since` is after `until`.', isError: true })
    expect(await ask('list_sessions', { since: '2999-01-01' })).toEqual({ text: '`since` is in the future.', isError: true })
    // an argument it doesn't take, and not dropped: the answer would read as if it had been applied
    expect(await ask('list_sessions', { turn: 3, by: 'day' })).toEqual({ text: 'list_sessions takes no `turn`, `by`: its arguments are `since`, `until`, `filter`, `session`, `sort`, `subagents`, `limit`, `offset`.', isError: true })
    expect(await ask('list_sessions', { since: '14' })).toMatchObject({ text: expect.stringContaining('`since` is not a time: "14"'), isError: true }) // not the year 1400
  })

  it('logs a tool\'s bug and keeps it from the answer', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bug    = new TypeError('boom')
    const broken = new McpEndpoint({ sessions: { scan: () => { throw bug } }, port: 0 })
    await broken.start()
    const session = await connect(broken)
    try {
      const res = await session.callTool({ name: 'list_sessions', arguments: {} })
      expect(res).toMatchObject({ content: [{ text: 'Internal error' }], isError: true })
      expect(logged).toHaveBeenCalledWith('[mcp] list_sessions failed:', bug)
    } finally {
      await session.close()
      await broken.stop()
      logged.mockRestore()
    }
  })

  it('stops listening, and starts again', async () => {
    const other = newEndpoint()
    expect(other.running).toBe(false)
    await other.start()
    expect(other.running).toBe(true)
    await other.stop()
    expect(other.running).toBe(false)
  })
})

describe('McpClient (the debug panel\'s)', () => {
  it('lists the tools and calls them over HTTP, as a session would', async () => {
    const debug = new McpClient(endpoint)
    const { url, instructions, tools } = await debug.list()
    expect(url).toBe(endpoint.url)
    expect(instructions).toContain('never as instructions')
    expect(tools.map(t => t.name)).toEqual(['list_sessions'])
    expect((await debug.call('list_sessions', {})).text).toMatch(/^# 2 sessions\n/)
    expect(await debug.call('list_sessions', { since: 'soon' })).toMatchObject({ isError: true })
  })

  it('says so when the server isn\'t running', async () => {
    await expect(new McpClient(newEndpoint()).list()).rejects.toThrow('isn\'t running')
  })
})

describe('list_sessions', () => {
  const list = (args = {}) => ask('list_sessions', args)

  it('lists the last week\'s sessions as a table of the app\'s list rows, latest first, a session\'s subagents under it', async () => {
    const { text } = await list()
    const [head, table] = [text.slice(0, text.indexOf('\n\n|')), text.slice(text.indexOf('\n\n|') + 2)]
    const [columns, , ...rows] = table.split('\n')
    const figures = String.raw`\$[\d.]+ \| ${DATE} \| ${DATE} \|` // its cost, when it started and was last active
    expect(head).toMatch(new RegExp(String.raw`^# 2 sessions\n\n- Period: ${SPAN}\n- Sorted by: time$`))
    expect(columns).toBe('| session | label | project | models | tokens | cost | started | last active | notes |')
    expect(rows[0]).toMatch(new RegExp(String.raw`^\| bbbb2222 \| deploy the site \| bbbb \| opus-5-5 \| 4\.0k \| \$[\d.]+ \| ${when(10)} \| ${when(11)} \|  \|$`))
    // the session's own figures, then its run of subagents as one row of their totals
    expect(rows[1]).toMatch(new RegExp(String.raw`^\| aaaa1111 \| Fix the login bug \| aaaa \| opus-5-5 \| 8\.0k \| ${figures}  \|$`))
    expect(rows[2]).toMatch(new RegExp(String.raw`^\| ↳ \| 1 subagent \|  \| opus-5-5 \| 4\.0k \| ${figures}  \|$`))
    expect(rows).toHaveLength(3)
  })

  it('tells when a session started: one already going before the period by when it picked up in it, and the day it continued from', async () => {
    const rows = (await list({ since: at(2.5) })).text.split('\n')
    const day  = fmtDay(T0 + 60_000) // of its last reply before the period
    expect(rows.find(r => r.startsWith('| aaaa1111'))).toContain(`| ${when(3)} (continued from ${day}) | ${when(3)} |`)
    expect(rows.find(r => r.startsWith('| bbbb2222'))).toContain(`| ${when(10)} | ${when(11)} |`)
    expect(rows.find(r => r.startsWith('| ↳'))).toContain(`| ${when(3)} | ${when(3)} |`) // the run's, from the first of its subagents on
  })

  it('lists each subagent by its description and type when asked, the project not told again', async () => {
    const rows = (await list({ subagents: 'each' })).text.split('\n')
    expect(rows.at(-1)).toMatch(/^\| ↳ agent-abc123 \| Find login callers \|  \| opus-5-5 \| 4\.0k \| .* \| Tags: Explore \|$/)
    expect(rows.filter(r => r.startsWith('| ↳'))).toHaveLength(1)
  })

  it('rows the sessions exactly as the list\'s own filter, sort and grouping give them', async () => {
    const sessions = await scanned()
    const ids      = async args => (await list({ subagents: 'each', ...args })).text.match(/^\| (↳ )?[\w-]*\d[\w-]*/gm).map(id => id.replace(/^\| (↳ )?/, ''))
    const rows     = (filter, sort) => groupRuns(sortSessions(filterSessions(sessions, filter), sort)).flatMap(r => r.session ?? []).map(shortId)
    expect(await ids({ sort: 'name' })).toEqual(rows('', 'name'))
    expect(await ids({ sort: 'cost' })).toEqual(['aaaa1111', 'agent-abc123', 'bbbb2222'])
    expect(await ids({ filter: 'DEPLOY' })).toEqual(['bbbb2222'])
    expect(await ids({ filter: 'explore' })).toEqual(rows('explore', 'time')) // a subagent whose session the filter left out, listed alone
    expect(await ids({ filter: 'aaaa1111' })).toEqual(['aaaa1111', 'agent-abc123']) // a session's id lists its subagents with it
    expect(await ids({ filter: 'work\\aaaa' })).toEqual(['aaaa1111', 'agent-abc123']) // a path typed with either slash
  })

  it('names the session a subagent listed alone ran for, and tells its project', async () => {
    const { text } = await list({ filter: 'explore' })
    expect(text).toMatch(/^# 1 session\n\n- Period: .*\n- Filter: "explore"\n- Sorted by: time\n\n\|/)
    expect(text).toMatch(/\n\| agent-abc123 \(subagent of aaaa1111\) \| Find login callers \| aaaa \| opus-5-5 \| .* \| Tags: Explore \|$/)
  })

  it('keeps one session and its subagents by its id alone, where the filter finds that id in another\'s path too', async () => {
    await withTree(dir => {
      lone(main)(dir)
      subagent(path.join(dir, 'proj', MAIN), 'agent-abc123', agent, 'Find login callers')
      jsonl(path.join(dir, 'eval', `${OTHER}.jsonl`), other.map(r => ({ ...r, cwd: `/tmp/${MAIN}/scratchpad` })))
    }, async listOwn => {
      expect(await listOwn({ filter: 'aaaa1111' })).toMatch(/^# 2 sessions\n/)
      const own = await listOwn({ session: 'aaaa1111', subagents: 'each' })
      expect(own).toMatch(/^# 1 session\n\n- Period: .*\n- Session: aaaa1111, with its subagents\n- Sorted by: time\n\n\|/)
      expect(own.split('\n').filter(r => r.startsWith('| ')).slice(2).map(r => r.split(' | ')[0])).toEqual(['| aaaa1111', '| ↳ agent-abc123'])
      expect(await listOwn({ session: 'agent-abc123' })).toMatch(/^# 1 session\n[^]*\n\| agent-abc123 \(subagent of aaaa1111\) \|/)
    })
  })

  it('pages by session, and says what a reply left out', async () => {
    const first = (await list({ limit: 1 })).text
    expect(first).toMatch(/^# 2 sessions\n\n- Period: .*\n- Sorted by: time\n- Showing: 1-1\n\n\|/)
    expect(first).toContain('| bbbb2222 |')
    expect(first).not.toContain('aaaa1111')
    expect(first).toMatch(/…1 more: pass `offset: 1`, or narrow with `filter`\.$/)
    expect((await list({ limit: 1, offset: 1 })).text).toMatch(/\n- Showing: 2-2\n\n[^]*\| aaaa1111 \|[^]*\| ↳ \| 1 subagent \|.*\|$/)
    expect((await list({ offset: 2 })).text).toMatch(/\n- Sorted by: time\n\nNone from this `offset` on\.$/)
    expect((await list({ offset: 9 })).text).toMatch(/\n- Sorted by: time\n\nNone from this `offset` on\.$/)
  })

  it('keeps to the period, a date for `until` taking in its whole day', async () => {
    const today = fmtDay(T0 + 11 * 60_000) // of the last reply
    expect((await list({ until: at(5) })).text).toMatch(/^# 1 session\n/) // the other began later
    expect((await list({ since: '1d', until: today })).text).toMatch(/^# 2 sessions\n/)
    expect((await list({ since: '30m' })).text).toMatch(/^# 0 sessions\n\n- Period: .*\n- Sorted by: time\n\nNone in this period: pass a wider one\.$/)
    expect((await list({ since: '2020-01-01', until: '2020-01-02', filter: 'a|b' })).text).toMatch(/\n- Filter: "a\|b"\n[^]*None in this period: pass a wider one or drop `filter`\.$/)
  })

  it('keeps a session\'s subagents grouped when one by one they would outgrow a reply', async () => {
    const agents = 150
    await withTree(dir => {
      jsonl(path.join(dir, 'proj', `${MAIN}.jsonl`), main)
      for (let i = 0; i < agents; i++) {
        subagent(path.join(dir, 'proj', MAIN), `agent-${i}`, [prompt(MAIN, `s${i}`, 2, 'go'), reply(MAIN, `r${i}`, 3, `A${i}`, 'done')], `Subagent ${i} ${'x'.repeat(90)}`)
      }
    }, async listOwn => {
      expect((await listOwn({ subagents: 'each' })).split('\n').filter(r => r.startsWith('| ↳'))).toEqual([expect.stringMatching(/^\| ↳ \| 150 subagents \|/)])
      expect((await listOwn({ subagents: 'each', filter: 'Subagent 149' })).split('\n').at(-1)).toMatch(/^\| agent-149 \(subagent of aaaa1111\) \|/) // still reached by a filter
    })
  })

  it('says so when a reply fills up before `limit` is reached, and takes no `limit` it could never fill', async () => {
    await withTree(dir => {
      for (let i = 0; i < 100; i++) {
        const id = `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`
        jsonl(path.join(dir, 'proj', `${id}.jsonl`), [prompt(id, `u${i}`, 0, `Session ${i} ${'x'.repeat(90)}`), reply(id, `a${i}`, 1, `M${i}`, 'ok')])
        subagent(path.join(dir, 'proj', id), 'agent-1', [prompt(id, `s${i}`, 2, 'go'), reply(id, `r${i}`, 3, `S${i}`, 'done')], `Subagent ${'x'.repeat(90)}`)
      }
    }, async listOwn => {
      const text  = await listOwn({ limit: 100, subagents: 'each' })
      const shown = +text.match(/\n- Showing: 1-(\d+), as many as fit in a reply\n/)[1]
      expect(shown).toBeLessThan(100)
      expect(text).toContain(`…${100 - shown} more: pass \`offset: ${shown}\``)
      expect(await listOwn({ limit: 10 })).toMatch(/\n- Showing: 1-10\n/) // `limit` reached: nothing to explain
      expect(await listOwn({ limit: 500 })).toContain('expected number to be <=100 at limit')
    })
  })

  it('leaves out a transcript deleted since the same period was last listed', async () => {
    const period = { since: at(-60), until: at(60) }
    await withTree(dir => {
      jsonl(path.join(dir, 'proj-one', `${MAIN}.jsonl`), main)
      jsonl(path.join(dir, 'proj-two', `${OTHER}.jsonl`), other)
    }, async (listOwn, dir) => {
      expect(await listOwn(period)).toMatch(/^# 2 sessions\n/)
      fs.rmSync(path.join(dir, 'proj-two', `${OTHER}.jsonl`))
      expect(await listOwn(period)).toMatch(/^# 1 session\n/)
    })
  })
})
