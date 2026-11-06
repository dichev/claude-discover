import { inRange } from '../requests/RequestFile.js'
import { texts } from '../requests/RequestParser.js'

const server = name => /^mcp__(.+?)__/.exec(name)?.[1] ?? null
const toolOf = (key, name) => name.slice(`mcp__${key}__`.length)

// How Claude Code spells a server in its tools' names (mcp__<server>__<tool>)
export const toolPrefix = name => name.replace(/[^\w-]/g, '_')

const connected = s => s.status === 'connected'

// One server's row in a turn; the debug log (McpDebugLog) fills in what the transcript doesn't log
export const serverRow = fields => ({
  transport: null, version: null, cached: false, ms: null, readyWithin: null, error: null, stderr: [], toolCount: null, groups: [], tools: [], ...fields,
})

// A server that mounts others (FastMCP's mount) prefixes each one's tools with its name, which is all that tells them
// apart: the tools sharing a first word, where there are several such groups but few enough that they aren't just verbs (get_…)
const mounted = (key, names) => {
  const groups = Object.entries(Object.groupBy(names, n => toolOf(key, n).split('_')[0]))
    .map(([name, list]) => ({ name, toolCount: list.length }))
  return groups.length >= 2 && groups.length ** 2 <= names.length ? groups.sort((a, b) => a.name.localeCompare(b.name)) : []
}

// The MCP servers each of the transcript's requests had: those whose tools it offered (what its shape sent, plus the
// deferred ones (ToolSearch) announced so far, which a shape leaves out until they're loaded), and those that failed,
// need a login or were still connecting, which the deferred-tools announcements list. Fed every transcript record.
export class McpTools {
  #shapes   = new Map() // shapeHash → the MCP tool names it sent
  #deferred = new Set() // deferred MCP tool names
  #status   = []        // { key, status, error } of the servers offering no tools, as last announced
  #names    = new Map() // tool prefix → the server's own name, where one was given
  #requests = []        // { ts, servers: [{ key, status, error, names? }], fresh }
  #calls    = new Map() // tool_use id → { key, name, ts, ms, error }

  feed(obj) {
    const att = obj.type === 'attachment' ? obj.attachment : null
    const content = Array.isArray(obj.message?.content) ? obj.message.content : []
    if (obj.type === 'api-request-shape') {
      this.#shapes.set(obj.shapeHash, (obj.shape?.tools ?? []).map(t => t.name).filter(server))
    } else if (att?.type === 'deferred_tools_delta') {
      for (const name of att.addedNames ?? []) if (server(name)) this.#deferred.add(name)
      for (const name of att.removedNames ?? []) this.#deferred.delete(name)
      // each announcement lists them all anew
      this.#status = [
        ...(att.failedMcpServers ?? []).map(f => this.#named(f.name, 'failed', f.errorCode ? `${f.errorCode}: ${f.error}` : f.error ?? null)),
        ...(att.needsAuthMcpServers ?? []).map(name => this.#named(name, 'needs-auth')),
        ...(att.pendingMcpServers ?? []).map(name => this.#named(name, 'pending')),
      ]
    } else if (att?.type === 'mcp_instructions_delta') {
      for (const name of att.addedNames ?? []) this.#names.set(toolPrefix(name), name)
    } else if (obj.type === 'api-request') {
      const tools = Object.groupBy(new Set([...this.#shapes.get(obj.shapeHash) ?? [], ...this.#deferred]), server)
      const servers = [
        ...Object.entries(tools).map(([key, names]) => ({ key, status: 'connected', error: null, names })),
        ...this.#status.filter(s => !tools[s.key]),
      ]
      // A request is logged as a diff on the process's previous one (`base`): one without is a new process (a resume, an SDK turn)
      this.#requests.push({ ts: Date.parse(obj.timestamp), servers: servers.sort((a, b) => a.key.localeCompare(b.key)), fresh: !obj.base })
    } else if (obj.type === 'assistant') {
      for (const c of content) {
        const key = c.type === 'tool_use' && server(c.name)
        if (key) this.#calls.set(c.id, { key, name: toolOf(key, c.name), ts: Date.parse(obj.timestamp), ms: null, error: null })
      }
    } else if (obj.type === 'user') {
      for (const c of content) {
        const call = c.type === 'tool_result' && this.#calls.get(c.tool_use_id)
        if (call) Object.assign(call, { ms: Date.parse(obj.timestamp) - call.ts, error: c.is_error ? texts(c.content).join('\n') || 'failed' : null })
      }
    }
  }

  #named(name, status, error = null) {
    this.#names.set(toolPrefix(name), name)
    return { key: toolPrefix(name), status, error }
  }

  // When each process sent its first request
  processStarts() {
    return this.#requests.filter(r => r.fresh).map(r => r.ts)
  }

  // The servers the period's first request had, again at each new process (which loads them all anew), and in between
  // a `change` turn with only those added, removed or whose status changed. Each tool call is listed under the latest
  // row of its server. The debug log (McpDebugLog) fills in transports, connect times and stderr.
  turns(range = null) {
    const turns = []
    const pending = new Map() // server → the request that found it still connecting
    let last = [] // what the latest turn's request had; never empty once set, as requests without servers are skipped
    for (const r of this.#requests) {
      if (!r.servers.length || !inRange(new Date(r.ts).toISOString(), range)) continue
      if (r.fresh) { last = []; pending.clear() }
      // a request offering no MCP tools (a compaction, say) isn't the servers going away
      if (last.some(connected) && !r.servers.some(connected)) continue
      const before = new Map(last.map(s => [s.key, s]))
      const changed = r.servers.filter(s => before.get(s.key)?.status !== s.status || before.get(s.key).error !== s.error)
      const removed = last.filter(s => !r.servers.some(n => n.key === s.key))
      if (!changed.length && !removed.length) continue
      // When it connected isn't logged: only that it had by this request, at most `readyWithin` after it was found connecting
      const row = s => {
        const readyWithin = connected(s) && pending.has(s.key) ? r.ts - pending.get(s.key) : null
        if (s.status === 'pending') pending.set(s.key, r.ts)
        else pending.delete(s.key)
        return serverRow({ name: this.#names.get(s.key) ?? s.key, status: s.status, readyWithin, error: s.error,
          toolCount: s.names?.length ?? null, groups: s.names ? mounted(s.key, s.names) : [] })
      }
      turns.push({ startedAt: new Date(r.ts).toISOString(), debug: false, change: last.length > 0,
        servers: [...changed.map(row), ...removed.map(s => row({ ...s, status: 'removed', error: null, names: null }))] })
      last = r.servers
    }
    for (const call of this.#calls.values()) {
      if (!inRange(new Date(call.ts).toISOString(), range)) continue
      const owner = s => toolPrefix(s.name) === call.key && connected(s)
      turns.findLast(t => Date.parse(t.startedAt) <= call.ts && t.servers.some(owner))
        ?.servers.find(owner).tools.push({ name: call.name, ms: call.ms, error: call.error })
    }
    return turns
  }
}
