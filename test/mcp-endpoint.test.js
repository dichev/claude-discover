// src/main/mcp: the tools other Claude Code sessions call, and the HTTP endpoint serving them
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { format, startOfWeek } from 'date-fns'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SessionsService } from '../src/main/services/SessionsService.js'
import { McpEndpoint } from '../src/main/mcp/McpEndpoint.js'
import { McpClient } from '../src/main/mcp/McpClient.js'
import { fmtDate, fmtDay, shortId } from '../src/main/mcp/tools/utils.js'
import { filterSessions, sortSessions, groupRuns } from '../src/renderer/sessions/sessionRows.js'
import { sumTotals } from '../src/renderer/timeline/periodTotals.js'
import { fmtCompact, fmtUSD } from '../src/renderer/utils/formatting.js'
import { flatten } from '../src/renderer/sessions/view/transcript.js'
import { markdownSession, renderTurns, sessionSummary } from '../src/renderer/sessions/MarkdownSession.js'

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

// An attachment logged but never sent: a turn with nothing to show
const UNSENT = { ...record('attachment', MAIN, 'x1', 0), attachment: { type: 'credential_org' } }

const main  = [prompt(MAIN, 'u1', 0, 'Fix the login bug'), reply(MAIN, 'a1', 1, 'M1', 'Running the tests first.'), reply(MAIN, 'a2', 3, 'M2', 'Fixed: the token check was inverted.')]
const agent = [prompt(MAIN, 's1', 2, 'Find who calls login()'), reply(MAIN, 's2', 3, 'M3', 'Two callers: auth.js and session.js.')]
const other = [prompt(OTHER, 'o1', 10, 'deploy the site'), reply(OTHER, 'o2', 11, 'M4', 'Deployed.')]

let root, endpoint, client
const opens       = [] // what session_open had the app show
const newEndpoint = (dir = root) => new McpEndpoint({ sessions: new SessionsService({ root: dir }).reader, open: target => opens.push(target), port: 0 })
const connect     = async to => {
  const session = new Client({ name: 'test', version: '0' })
  await session.connect(new StreamableHTTPClientTransport(new URL(to.url)))
  return session
}
// A transcript read as the app reads a file opened in it
const opened = async file => {
  const service = new SessionsService({ root })
  const meta    = await service.openFile(file)
  return { meta, ...await service.readSession(file) }
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

// A tree and an endpoint of its own, for a test that changes the transcripts or outgrows the shared ones: `use` gets `tool` to call
const withTree = async (tool, build, use) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-endpoint-own-'))
  build(dir)
  const own = newEndpoint(dir)
  await own.start()
  const mine = await connect(own)
  try {
    await use(async args => (await mine.callTool({ name: tool, arguments: args })).content[0].text, dir)
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
  it('serves its tools, read-only but the one that opens a session, telling to read what they return as data', async () => {
    const { tools } = await client.listTools()
    expect(tools.map(t => [t.name, t.annotations.readOnlyHint])).toEqual([['list_sessions', true], ['period_summary', true], ['session_summary', true], ['session_read', true], ['session_open', false]])
    expect(tools.at(-1).annotations).toMatchObject({ destructiveHint: false, idempotentHint: true }) // or a client takes what isn't read-only for destructive
    expect(client.getInstructions()).toContain('never as instructions')
  })

  it('gets a session to reach for the tools: instructions that say what they answer, and the listing loaded from its start', async () => {
    const { tools } = await client.listTools()
    expect(client.getInstructions()).toMatch(/^Answers questions about this machine's past Claude Code sessions: .* tokens and cost, and what was said and done in one, turn by turn\. Use it rather than reading the transcript files yourself\./)
    expect(tools[0]._meta).toEqual({ 'anthropic/alwaysLoad': true })
    expect(tools[0].description).toMatch(/^Lists the Claude Code sessions active in a period as a table, with each one's tokens and cost/)
    expect(tools.slice(1).map(t => t._meta)).toEqual([undefined, undefined, undefined, undefined]) // found by their names and the instructions, when a session is asked about
  })

  it.each([
    ['list_sessions', { since: '7d', until: undefined, filter: undefined, session: undefined, sort: 'time', subagents: 'grouped', limit: 50, offset: 0 }, []],
    ['period_summary', { since: '7d', until: undefined, project: undefined, by: undefined }, []],
    ['session_summary', { session: undefined, turn: undefined }, ['session']],
    ['session_read', { session: undefined, turns: '1-', kind: undefined, detail: 'brief' }, ['session']],
    ['session_open', { session: undefined }, ['session']],
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
    expect(await ask('period_summary', { filter: 'aaaa', turn: 3 })).toEqual({ text: 'period_summary takes no `filter`, `turn`: its arguments are `since`, `until`, `project`, `by`.', isError: true })
    expect(await ask('list_sessions', { since: '14' })).toMatchObject({ text: expect.stringContaining('`since` is not a time: "14"'), isError: true }) // not the year 1400
  })

  it('logs a tool\'s bug and keeps it from the answer', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bug    = new TypeError('boom')
    const broken = new McpEndpoint({ sessions: new SessionsService({ root }).reader, open: () => { throw bug }, port: 0 })
    await broken.start()
    const session = await connect(broken)
    try {
      const res = await session.callTool({ name: 'session_open', arguments: { session: MAIN } })
      expect(res).toMatchObject({ content: [{ text: 'Internal error' }], isError: true })
      expect(logged).toHaveBeenCalledWith('[mcp] session_open failed:', bug)
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
    expect(tools.map(t => t.name)).toEqual(['list_sessions', 'period_summary', 'session_summary', 'session_read', 'session_open'])
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
    await withTree('list_sessions', dir => {
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
    await withTree('list_sessions', dir => {
      lone(main)(dir)
      for (let i = 0; i < agents; i++) {
        subagent(path.join(dir, 'proj', MAIN), `agent-${i}`, [prompt(MAIN, `s${i}`, 2, 'go'), reply(MAIN, `r${i}`, 3, `A${i}`, 'done')], `Subagent ${i} ${'x'.repeat(90)}`)
      }
    }, async listOwn => {
      expect((await listOwn({ subagents: 'each' })).split('\n').filter(r => r.startsWith('| ↳'))).toEqual([expect.stringMatching(/^\| ↳ \| 150 subagents \|/)])
      expect((await listOwn({ subagents: 'each', filter: 'Subagent 149' })).split('\n').at(-1)).toMatch(/^\| agent-149 \(subagent of aaaa1111\) \|/) // still reached by a filter
    })
  })

  it('says so when a reply fills up before `limit` is reached, and takes no `limit` it could never fill', async () => {
    await withTree('list_sessions', dir => {
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
    await withTree('list_sessions', dir => {
      jsonl(path.join(dir, 'proj-one', `${MAIN}.jsonl`), main)
      jsonl(path.join(dir, 'proj-two', `${OTHER}.jsonl`), other)
    }, async (listOwn, dir) => {
      expect(await listOwn(period)).toMatch(/^# 2 sessions\n/)
      fs.rmSync(path.join(dir, 'proj-two', `${OTHER}.jsonl`))
      expect(await listOwn(period)).toMatch(/^# 1 session\n/)
    })
  })
})

describe('period_summary', () => {
  const summary = (args = {}) => ask('period_summary', args)
  // A table's rows without their cost, which the rates decide
  const table   = (text, heading) => text.split(`\n## ${heading}\n`)[1].split('\n\n')[0].split('\n').slice(2).map(row => row.replace(/ \$[\d.]+ \|$/, ''))
  // Each reply's 4020 tokens fall where its request began, at the record before it
  const began  = [0, 1, 2, 10]
  const rowsBy = label => [...Map.groupBy(began, min => label(T0 + min * 60_000))].map(([start, replies]) => `| ${start} | ${fmtCompact(replies.length * 4020)} |`)
  const hour   = ts => format(ts, 'yyyy-MM-dd HH:00')

  it('gives the period\'s totals as the app\'s Period Summary sums them, the tokens by kind and the projects, costliest first', async () => {
    const totals   = sumTotals(await scanned())
    const { text } = await summary()
    expect(totals.totalTokens).toBe(16_080) // subagents counted in
    expect(text).toMatch(new RegExp(String.raw`^# Period summary\n\n- Period: ${SPAN}\n- Estimated cost: \$${fmtUSD(totals.cost).slice(1)}\n- Total tokens: 16\.1k\n- Working time: .+\n\n## Tokens\n\| kind \| tokens \| cost \|\n`))
    expect(table(text, 'Tokens')).toEqual(['| Cache read | 0 |', '| Cache write | 0 |', '| Output | 80 |', '| Input | 16.0k |'])
    expect(table(text, 'By project')).toEqual(['| aaaa | 12.1k |', '| bbbb | 4.0k |'])
    expect(text).not.toContain('## Potential savings') // none worth telling
  })

  it('tells the usage over time as the chart buckets it: by the day, or the hour for a period within a day, the empty ones left out', async () => {
    const rows = async args => {
      const { text } = await summary(args)
      const [, by]   = text.match(/\n## By (hour|day|week|month)\n\| \1 \| tokens \| cost \|\n/)
      return [by, table(text, `By ${by}`)]
    }
    expect(await rows()).toEqual(['day', rowsBy(fmtDay)])
    expect(await rows({ since: '24h' })).toEqual(['hour', rowsBy(hour)])
    expect(await rows({ by: 'hour' })).toEqual(['hour', rowsBy(hour)])
    expect(await rows({ by: 'week' })).toEqual(['week', rowsBy(ts => fmtDay(startOfWeek(ts, { weekStartsOn: 1 })))])
    expect(await rows({ since: '30d', by: 'month' })).toEqual(['month', rowsBy(ts => format(ts, 'yyyy-MM'))])
  })

  it('counts the period only, and says so when it holds no sessions', async () => {
    const later = (await summary({ since: at(5) })).text // the other session alone
    expect(later).toContain('\n- Total tokens: 4.0k\n')
    expect(table(later, 'By project')).toEqual(['| bbbb | 4.0k |'])
    expect((await summary({ since: '2020-01-01', until: '2020-01-02' })).text).toMatch(/^# Period summary\n\n- Period: 2020-01-01 00:00 → 2020-01-02 23:59 \(GMT[^)]*\)\n\nNo sessions in this period: pass a wider one\.$/)
  })

  it('counts only the projects asked for, by their name as listed or their path', async () => {
    const of = async project => { const { text } = await summary({ project }); return [text.match(/\n- Project: "(.*)"\n/)[1], text.match(/- Total tokens: (.*)/)[1], table(text, 'By project')] }
    expect(await of(' BBBB ')).toEqual(['BBBB', '4.0k', ['| bbbb | 4.0k |']])
    expect(await of('work\\aaaa')).toEqual(['work\\aaaa', '12.1k', ['| aaaa | 12.1k |']]) // its subagent's with it
    expect((await of('work'))[1]).toBe('16.1k')
    expect((await summary({ project: 'fix the login' })).text).toMatch(/\n- Project: "fix the login"\n\nNo sessions in this period: pass a wider one or drop `project`\.$/) // not by what a session is about
  })

  it('tells apart the projects still sharing a name by their path, and leaves out one that used nothing', async () => {
    const THIRD = 'cccc3333-0000-4000-8000-000000000003'
    const inDir = (cwd, records) => records.map(r => ({ ...r, cwd }))
    await withTree('period_summary', dir => {
      jsonl(path.join(dir, 'one', `${MAIN}.jsonl`), inDir('/x/a/roles/support', main))
      jsonl(path.join(dir, 'two', `${OTHER}.jsonl`), inDir('/y/a/roles/support', other))
      jsonl(path.join(dir, 'three', `${THIRD}.jsonl`), inDir('/z/idle', [prompt(THIRD, 'c1', 20, 'hello?')]))
    }, async summaryOwn => {
      const rows = table(await summaryOwn({}), 'By project').map(row => row.replace(/\\/g, '/'))
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatch(/^\| .*\/x\/a\/roles\/support \| 8\.0k \|$/)
      expect(rows[1]).toMatch(/^\| .*\/y\/a\/roles\/support \| 4\.0k \|$/)
    })
  })

  it('refuses more rows than a year of days before reading any session', async () => {
    expect(await summary({ since: '2020-01-01' })).toEqual({ text: 'The period has more than 366 days: pass a coarser `by`, or a shorter period.', isError: true })
    expect(await summary({ since: '60d', by: 'hour' })).toMatchObject({ text: expect.stringContaining('more than 366 hours'), isError: true })
    expect((await summary({ since: '2020-01-01', by: 'month' })).text).toContain('\n- Total tokens: 16.1k\n')
  })
})

describe('session_summary', () => {
  const summary = (args = {}) => ask('session_summary', { session: 'aaaa1111', ...args })

  it('gives a session\'s figures as the app\'s markdown export writes them, under the session\'s label', async () => {
    const { meta, items, instructions } = await opened(path.join(root, 'proj-one', `${MAIN}.jsonl`))
    const own = sessionSummary(meta, flatten(items, instructions), instructions)
    expect(own).toMatch(/^# Summary\n- Estimated cost: \$[\d.]+\n- Total tokens: 8\.0k\n[^]*\n## Identity\n[^]*\n- Log file: .*aaaa1111-0000-4000-8000-000000000001\.jsonl$/)
    expect(markdownSession(meta, items, instructions).body).toContain(`<summary>\n\n# Session: ${MAIN}\n\n${own}\n\n</summary>`) // what the agent is given
    // with as many turns as session_read numbers, each event told by its own
    const [title, head, ...rest] = (await summary()).text.replace(/ · #\d+$/gm, '').split('\n\n')
    expect(title).toBe('# aaaa1111 · Fix the login bug')
    expect(head).toMatch(new RegExp(`^- Active: ${SPAN}\n- Turns: 3$`)) // when, by the day: the summary tells the time alone
    expect(rest.join('\n\n')).toBe(own)
  })

  it('names the turn each event is read from, by the numbers session_read gives them', async () => {
    const records = [prompt(MAIN, 'u1', 0, 'go'), reply(MAIN, 'a1', 1, 'M1', 'Looking.'), prompt(MAIN, 'u2', 2, 'faster'), reply(MAIN, 'a2', 3, 'M2', 'Done.', { model: 'claude-sonnet-5-5' })]
    await withTree('session_summary', lone(records), async summaryOwn => {
      expect(await summaryOwn({ session: MAIN })).toMatch(/\n\n## Events\n- [\d:]+ Session start · #1\n- [\d:]+ Model: sonnet-5-5 · #4\n- [\d:]+ Latest · #4\n\n## Context size\n/)
    })
  })

  it('gives the figures as they were at a turn: what was spent by the end of its row, and the context holding it', async () => {
    const records = [prompt(MAIN, 'u1', 0, 'go'), reply(MAIN, 'a1', 1, 'M1', 'Looking.'), prompt(MAIN, 'u2', 2, 'more'), reply(MAIN, 'a2', 3, 'M2', 'Done.', { usage: { ...usage, input_tokens: 9000 } })]
    await withTree('session_summary', lone(records), async summaryOwn => {
      const figuresAt = async turn => {
        const text = await summaryOwn({ session: MAIN, turn })
        return [text.match(/\n- Turns: 4\n- Summary, Context and Tokens are as of turn #(\d+), the rest is the whole session's\n\n# Summary/)?.[1], text.match(/- Total tokens: (.*)/)[1], text.match(/- (.*ontext size: \S+)/)[1]]
      }
      expect(await figuresAt()).toEqual([undefined, '13.0k', 'Last context size: 9.0k']) // the session's end
      expect(await figuresAt(1)).toEqual(['1', '0', 'Context size: 4.0k'])               // nothing replied yet, in the first request's context
      expect(await figuresAt(2)).toEqual(['2', '4.0k', 'Context size: 9.0k'])
      expect(await summaryOwn({ session: MAIN, turn: 9 })).toBe('No turn 9: the session\'s turns are 1-4.')
    })
  })

  it('says which turns it counted as one, for a turn inside a reply\'s tool calls', async () => {
    const call    = record('assistant', MAIN, 'a1', 1, { id: 'M1', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }], usage })
    const records = [prompt(MAIN, 'u1', 0, 'go'), call, reply(MAIN, 'a2', 2, 'M2', 'Done.')]
    await withTree('session_summary', lone(records), async summaryOwn => {
      const notes = async turn => (await summaryOwn({ session: MAIN, turn })).split('\n\n')[1].replace(/^- Active: .*\n/, '')
      expect(await notes(2)).toBe('- Turns: 3\n- Summary, Context and Tokens are as of turn #3, the rest is the whole session\'s\n- Turn #2 has no figures of its own: turns #2-3 are counted as one')
      expect(await notes(3)).toBe('- Turns: 3\n- Summary, Context and Tokens are as of turn #3, the rest is the whole session\'s')
      expect(await summaryOwn({ session: MAIN })).toMatch(/\n- [\d:]+ Latest · #3\n/) // the session's end, not where its last row begins
    })
  })

  it('numbers only the turns session_read shows, an event in one that shows nothing told by the next', async () => {
    await withTree('session_summary', lone([UNSENT, ...main]), async summaryOwn => {
      expect(await summaryOwn({ session: MAIN })).toMatch(/\n- Turns: 3\n\n[^]*\n- [\d:]+ Session start · #1\n/)
    })
  })

  it('points to the listing of the subagents a session launched, and names the session a subagent ran for', async () => {
    const launch  = record('assistant', MAIN, 'a1', 1, { id: 'M1', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { prompt: 'look' } }], usage })
    const records = [prompt(MAIN, 'u1', 0, 'go'), launch, reply(MAIN, 'a2', 2, 'M2', 'Done.')]
    await withTree('session_summary', dir => {
      lone(records)(dir)
      subagent(path.join(dir, 'proj', MAIN), 'agent-abc123', agent, 'Find login callers')
    }, async summaryOwn => {
      const [, cost, total, hint] = (await summaryOwn({ session: MAIN })).match(/\n- Turns: 3\n- Subagents: 1, costing \$([\d.]+) more \(\$([\d.]+) with the session's own\), not counted here\. (.*)\n\n# Summary\n- Estimated cost: \$/)
      expect(+total).toBeGreaterThan(+cost)
      expect(hint).toBe(`list_sessions gives their ids, tasks and cost, with \`session: "aaaa1111"\`, \`subagents: "each"\` and \`since: "${fmtDay(T0)}"\``)
    })
    await withTree('session_summary', lone(records), async summaryOwn => expect(await summaryOwn({ session: MAIN })).not.toContain('- Subagents: ')) // launched, its transcript gone
    const own = (await summary({ session: 'agent-abc123' })).text
    expect(own).toMatch(/^# agent-abc123 · Find login callers\n\n- Subagent of: aaaa1111\n- Active: .*\n- Turns: 2\n\n# Summary\n/)
    expect(own).not.toContain('- Subagents: ')
  })
})

describe('session_read', () => {
  const read  = (args = {}) => ask('session_read', { session: 'aaaa1111', ...args })
  const BRIEF = '- Each block is cut to its first lines: pass `detail: "full"` for whole ones'
  const shown = text => text.match(/^#\d+/gm) ?? []

  it('reads a conversation turn by turn, each numbered and written as the app\'s markdown export writes it', async () => {
    const { items, instructions } = await opened(path.join(root, 'proj-one', `${MAIN}.jsonl`))
    const own = renderTurns(flatten(items, instructions)).map((text, i) => `#${i + 1} ${text}\n\n---\n\n`)
    expect(own).toHaveLength(3)
    expect(own[2]).toMatch(/^#3 \*\*Assistant · [\d:]+ \(.*\):\*\*\n\nFixed: the token check was inverted\./)
    const [title, , about, ...rest] = (await read()).text.split('\n')
    expect(title).toBe('# aaaa1111 · Fix the login bug')
    expect(about).toMatch(new RegExp(String.raw`^- aaaa · opus-5-5 · 8\.0k tokens · \$[\d.]+ · ${SPAN}$`)) // the session's row in a listing, and when it ran
    expect(rest.join('\n')).toBe(`- Turns: 1-3 of 3\n${BRIEF}\n\n${own.join('')}End of the session.`)
  })

  it('takes a range of turns, the last ones, one, or the final reply on', async () => {
    const turnsOf = async turns => { const { text } = await read({ turns }); return [text.match(/- Turns: (.*)/)[1], shown(text).join(' '), text.split('\n').at(-1)] }
    expect(await turnsOf('2')).toEqual(['2-2 of 3', '#2', 'Running the tests first.']) // all that was asked for: nothing said of a rest
    expect(await turnsOf('1-2')).toEqual(['1-2 of 3', '#1 #2', 'Running the tests first.'])
    expect(await turnsOf('2-')).toEqual(['2-3 of 3', '#2 #3', 'End of the session.'])
    expect(await turnsOf('2-9')).toEqual(['2-3 of 3', '#2 #3', 'End of the session.'])
    expect(await turnsOf('-1')).toEqual(['3-3 of 3', '#3', 'End of the session.'])
    expect(await turnsOf('last')).toEqual(['3-3 of 3', '#3', 'End of the session.'])
    expect(await read({ turns: 'some' })).toEqual({ text: '`turns` is not a range: "some". Use "37-60", "300-", "-20", "212" or "last".', isError: true })
  })

  it('refuses a turn the session doesn\'t have, and a range that runs backwards', async () => {
    for (const turns of ['9', '9-', '0']) {
      expect(await read({ turns })).toEqual({ text: `No turn ${parseInt(turns)}: the session's turns are 1-3.`, isError: true })
    }
    expect(await read({ turns: '3-1' })).toMatchObject({ text: expect.stringContaining('`turns` is not a range: "3-1"'), isError: true })
    expect(await read({ turns: '-0' })).toMatchObject({ text: expect.stringContaining('`turns` is not a range: "-0"'), isError: true }) // not the session whole
  })

  it('numbers only the turns with something to show, leaving no holes', async () => {
    await withTree('session_read', lone([main[0], UNSENT, ...main.slice(1)]), async readOwn => {
      const text = await readOwn({ session: MAIN })
      expect(text).toContain('\n- Turns: 1-3 of 3\n')
      expect(shown(text)).toEqual(['#1', '#2', '#3'])
    })
  })

  it('keeps the one kind of turn asked for, numbered as in the whole', async () => {
    const user = (await read({ kind: 'user' })).text
    expect(user).toContain('\n- Turns: 1-3 of 3\n- Kind: user\n')
    expect(shown(user)).toEqual(['#1'])
    expect(shown((await read({ kind: 'assistant' })).text)).toEqual(['#2', '#3'])
    expect(shown((await read({ kind: 'user', turns: '-1' })).text)).toEqual(['#1']) // the last of its kind, not of the session
    expect(shown((await read({ kind: 'assistant', turns: '-1' })).text)).toEqual(['#3'])
    expect(shown((await read({ kind: 'user', turns: '-9' })).text)).toEqual(['#1'])
    expect((await read({ kind: 'other' })).text).toMatch(/\n- Kind: other\n.*\n\nNothing to show in these turns\.\n\nEnd of the session\.$/)
    expect(await read({ kind: 'tools' })).toMatchObject({ isError: true })
  })

  it('cuts every block to its first lines, or gives them whole', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
    await withTree('session_read', lone([prompt(MAIN, 'u1', 0, 'count'), reply(MAIN, 'a1', 1, 'M1', lines)]), async readOwn => {
      const brief = await readOwn({ session: MAIN })
      expect(brief).toContain(BRIEF)
      expect(brief).toContain('line 10\n--- 20 lines truncated ---')
      const full = await readOwn({ session: MAIN, detail: 'full' })
      expect(full).not.toContain(BRIEF)
      expect(full).toContain(lines)
    })
  })

  it('gives a long session whole, for a caller to search where its client saved the reply', async () => {
    const replies = Array.from({ length: 40 }, (_, i) => reply(MAIN, `a${i}`, i + 1, `M${i}`, 'q'.repeat(1000)))
    const long    = reply(MAIN, 'z', 50, 'Z', 'z'.repeat(60_000))
    await withTree('session_read', lone([prompt(MAIN, 'u1', 0, 'go'), ...replies, long]), async readOwn => {
      const text = await readOwn({ session: MAIN, detail: 'full' })
      expect(text).toContain('\n- Turns: 1-42 of 42\n\n#1 ')
      expect(shown(text)).toHaveLength(42)
      expect(text.match(/q/g)).toHaveLength(40_000)
      expect(text.match(/z/g)).toHaveLength(60_000)
      expect(text.slice(-30)).toBe('zzzz\n\n---\n\nEnd of the session.')
    })
  })

  it('tells a reply\'s context size once, with the first of its turns, whichever of them a call starts from', async () => {
    const records = [prompt(MAIN, 'u1', 0, 'go'), reply(MAIN, 'a1', 1, 'M1', 'Looking.'), reply(MAIN, 'a2', 1, 'M1', 'Done.')]
    await withTree('session_read', lone(records), async readOwn => {
      const third = async args => (await readOwn({ session: MAIN, ...args })).match(/^#3 .*/m)[0]
      const whole = await third()
      expect(whole).toMatch(/^#3 \*\*Assistant · [\d:]+( \([^)]*\))?:\*\*$/)
      expect(whole).not.toContain('context')
      expect(await third({ turns: '3' })).toBe(whole)
      expect(await third({ kind: 'assistant', turns: '3' })).toBe(whole)
    })
  })

  it('finds a session by its id or the start of it, and a subagent by its name', async () => {
    expect((await read({ session: MAIN })).text).toMatch(/^# aaaa1111 · Fix the login bug\n/)
    expect((await read({ session: 'bbbb' })).text).toMatch(/^# bbbb2222 · deploy the site\n/)
    expect((await read({ session: 'agent-abc123' })).text).toMatch(/^# agent-abc123 · Find login callers\n\n- subagent of aaaa1111 · .*\n- Turns: 1-2 of 2\n[^]*Two callers: auth\.js and session\.js\./)
    expect((await read({ session: 'abc123' })).text).toMatch(/^# agent-abc123 · /) // its id as its session's transcript prints it
    expect(await read({ session: 'abc' })).toMatchObject({ isError: true })         // whole, though: a start could be a session's
    expect(await read({ session: 'cccc' })).toEqual({ text: 'No session "cccc": list_sessions gives their ids.', isError: true })
    expect(await read({ session: ' ' })).toMatchObject({ isError: true })
  })

  it('tells apart the transcripts sharing an id, one per project the session ran in', async () => {
    await withTree('session_read', dir => {
      jsonl(path.join(dir, 'proj-one', `${MAIN}.jsonl`), main)
      jsonl(path.join(dir, 'proj-two', `${MAIN}.jsonl`), other)
    }, async readOwn => {
      expect(await readOwn({ session: 'aaaa1111' })).toBe(`"aaaa1111" names 2 transcripts, pass one as \`session\`:\n- proj-one/${MAIN}\n- proj-two/${MAIN}`)
      expect(await readOwn({ session: `proj-two/${MAIN}` })).toMatch(/\n\n#1 \*\*User · [\d:]+.*:\*\*\n\ndeploy the site\n/)
    })
  })
})

describe('session_open', () => {
  const open = async session => {
    opens.length = 0
    return { ...await ask('session_open', { session }), opens: [...opens] }
  }
  const day = fmtDay(T0 + 3 * 60_000) // of the session's last reply

  it('has the app show the session on its last active day, picked by its file', async () => {
    expect(await open('aaaa1111')).toEqual({
      text: `Opened aaaa1111 · Fix the login bug in Claude Discover, on ${day}.`, isError: false,
      opens: [{ id: path.join(root, 'proj-one', `${MAIN}.jsonl`), date: day }],
    })
    expect(await open('agent-abc123')).toMatchObject({
      text: `Opened agent-abc123 · Find login callers in Claude Discover, on ${day}.`,
      opens: [{ id: path.join(root, 'proj-one', MAIN, 'subagents', 'agent-abc123.jsonl'), date: day }],
    })
  })

  it('shows nothing for a session it can\'t find', async () => {
    expect(await open('cccc')).toEqual({ text: 'No session "cccc": list_sessions gives their ids.', isError: true, opens: [] })
  })

  // Claude Code started and quit: a hook's output and no message, which a listing lists as any other
  it('takes a session with no messages in it, as the other session tools do', async () => {
    const hook = { ...record('attachment', MAIN, 'x1', 0), attachment: { type: 'hook_success', content: 'ok' } }
    for (const [tool, answer] of [['session_open', /^Opened aaaa1111 · /], ['session_summary', /^# aaaa1111 · /], ['session_read', /^aaaa1111 has no conversation\.$/]]) {
      await withTree(tool, lone([hook]), async askOwn => expect(await askOwn({ session: MAIN })).toMatch(answer))
    }
    await withTree('list_sessions', lone([hook]), async listOwn => expect(await listOwn({})).toContain('| aaaa1111 |'))
  })
})
