import fsp from 'node:fs/promises'
import { join } from 'node:path'
import { CLAUDE_DEBUG_DIR } from '../paths.js'
import { serverRow, toolPrefix } from './McpTools.js'

const LINE      = /^(\S+) \[\w+\] (.*)$/
const SERVER    = /^MCP server "([^"]+)":? ([\s\S]*)$/
const PROCESS   = /^mcp runtime arm\b/ // logged once as each process (so each turn) sets up MCP
const TIMESTAMP = /^\d{4}-\d\d-\d\dT/

// A message spanning lines is logged as one JSON string instead
const unquote = text => {
  if (!text.startsWith('"')) return text
  try { return JSON.parse(text) } catch { return text }
}

// Claude Code's debug log (`--debug`, the Agent SDK's `debug: true`), which fills in the transcript's turns of MCP
// servers (McpTools) where the session has one. A resumed turn appends to the same <sessionId>.txt.
export class McpDebugLog {
  constructor(sessionId, { dir = CLAUDE_DEBUG_DIR } = {}) {
    this.filePath = join(dir, `${sessionId}.txt`)
  }

  exists() {
    return fsp.access(this.filePath).then(() => true, () => false)
  }

  // Returns the log's path, or null when the session ran without debug
  async fillIn(turns, processStarts) {
    const text = await fsp.readFile(this.filePath, 'utf8').catch(() => null)
    if (text === null) return null
    fillTurns(turns, parseMcpLog(text), processStarts)
    return this.filePath
  }
}

// Each logged process fills in the turns of the requests it sent: from the first one sent after it started (a request
// logged whole) up to the next such. A process that sent none (or ran without debug) has no turns.
function fillTurns(turns, processes, starts) {
  const processOf = turn => starts.findLast(ts => ts <= Date.parse(turn.startedAt))
  processes.forEach((p, i) => {
    const end = processes[i + 1] ? Date.parse(processes[i + 1].startedAt) : Infinity
    const first = starts.find(ts => ts >= Date.parse(p.startedAt) && ts < end)
    const own = first === undefined ? [] : turns.filter(t => processOf(t) === first)
    if (own.length) fillProcess(own, p.servers)
  })
}

function fillProcess(turns, logged) {
  const rows = turns.flatMap(t => t.servers)
  for (const t of turns) t.debug = true
  for (const log of logged) {
    const own = rows.filter(s => toolPrefix(s.name) === toolPrefix(log.name))
    // a server the requests never listed (still connecting, or failed on a CLI that doesn't announce it)
    if (!own.length) {
      if (!turns[0].change) turns[0].servers.push(log)
      continue
    }
    for (const row of own) {
      Object.assign(row, { name: log.name, transport: log.transport })
      if (row.status === log.status) Object.assign(row, { ms: log.ms, readyWithin: null, error: row.error ?? log.error, stderr: log.stderr })
    }
    // the server's own times for the calls the transcript logged, and the calls only the log has (Claude Code's own)
    const calls = own.flatMap(row => row.tools)
    for (const call of log.tools) {
      const i = calls.findIndex(c => c.name === call.name)
      if (i === -1) {
        own.find(row => row.status === 'connected')?.tools.push({ ...call })
      } else {
        const matched = calls.splice(i, 1)[0]
        Object.assign(matched, { ms: call.ms ?? matched.ms, error: call.error ?? matched.error })
      }
    }
  }
  // An Agent SDK server (createSdkMcpServer) runs in the host's own process: the log names no connection for it
  for (const row of rows) if (row.status === 'connected' && row.transport === null) row.transport = 'sdk'
}

// The log is free text, not a contract: a line that doesn't match is skipped.
export function parseMcpLog(text) {
  const processes = []
  const open = startedAt => processes.push({ startedAt, servers: [] })
  const latest = new Map()     // server → its latest connection, which the later lines about it describe
  const transports = new Map() // server → the transport it's initializing, logged ahead of its start (http only)
  let stderr = null            // the stderr lines a timestamp-less continuation line belongs to
  for (const line of text.split(/\r?\n/)) {
    if (stderr && line && !TIMESTAMP.test(line)) { stderr.push(line); continue }
    stderr = null
    const l = LINE.exec(line)
    if (!l) continue
    const [, timestamp, text] = l
    if (PROCESS.test(text)) { open(timestamp); continue }
    const m = SERVER.exec(unquote(text))
    if (!m) continue
    const [, name, msg] = m
    let r
    if (msg.startsWith('Starting connection')) {
      // Without the process line (another CLI version), a process shows as a server starting again
      if (!processes.length || processes.at(-1).servers.some(s => s.name === name)) open(timestamp)
      const conn = serverRow({ name, transport: transports.get(name) ?? null, status: 'connecting' })
      transports.delete(name)
      processes.at(-1).servers.push(conn)
      latest.set(name, conn)
      continue
    }
    if ((r = /^Initializing (\w+) transport/.exec(msg))) {
      transports.set(name, r[1].toLowerCase())
      continue
    }
    const conn = latest.get(name)
    if (!conn) continue
    if ((r = /^Successfully connected \(transport: ([\w-]+)\) in (\d+)ms/.exec(msg))) {
      Object.assign(conn, { status: 'connected', transport: r[1], ms: +r[2] })
    } else if ((r = /^Connection failed after (\d+)ms[^(:]*(?:\(([^)]+)\))?:?\s*(.*)/.exec(msg))) {
      Object.assign(conn, { status: 'failed', ms: +r[1], error: [r[2], r[3]].filter(Boolean).join(': ') })
    } else if ((r = /^Server stderr: (.*)/.exec(msg))) {
      conn.transport ??= 'stdio' // only a process has a stderr
      conn.stderr.push(r[1])
      stderr = conn.stderr
    } else if ((r = /^Calling MCP tool: (.+)/.exec(msg))) {
      conn.tools.push({ name: r[1], ms: null, error: null })
    } else if ((r = /^Tool '(.+)' (?:completed successfully in|failed after) ([\d.]+)(ms|s)(?:: ([\s\S]*))?/.exec(msg))) {
      const call = conn.tools.find(t => t.name === r[1] && t.ms === null)
      if (call) Object.assign(call, { ms: r[3] === 's' ? Math.round(r[2] * 1000) : +r[2], error: msg.includes(' failed ') ? r[4] ?? 'failed' : null })
    }
  }
  return processes
}
