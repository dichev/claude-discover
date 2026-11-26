// Register the app's MCP server (src/main/mcp/McpEndpoint.js) in Claude Code's user-scope MCP servers. Backs the StatusBar's
// status + Activate/Deactivate button; sole owner of that entry. The server itself runs whenever the app is open (Application
// starts it), so an entry the user adds at another scope works too. The entry is added and removed through the `claude` CLI:
// running sessions rewrite that file all the time, so it's theirs to write. It's the user's own config whatever Claude dir
// the app is on: one server per machine, so one entry, and none left behind in a dir the app has moved off.
// The server lives in this app, so a registration kept after the app closes shows in Claude Code as a server that failed to connect.
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import which from 'which'
import { MCP_NAME } from '../../mcp/McpEndpoint.js'
import { CLAUDE_JSON } from '../../paths.js'

const run = promisify(execFile)

export class McpSwitch {
  #endpoint

  constructor({ endpoint }) {
    this.#endpoint = endpoint
  }

  status() {
    const { running, url } = this.#endpoint
    return { running, configured: this.#registered() === url, url }
  }

  // Listen first (a retry, if the port was taken at launch), so Claude Code is never pointed at someone else's server
  async activate() {
    await this.#endpoint.start()
    const { url } = this.#endpoint
    if (this.#registered() === url) return
    await this.deactivate() // an entry of ours with a stale address
    await this.#claude('add', '--transport', 'http', '--scope', 'user', MCP_NAME, url)
  }

  async deactivate() {
    if (this.#registered()) await this.#claude('remove', '--scope', 'user', MCP_NAME)
  }

  // The address Claude Code has for our server; undefined when it has none
  #registered() {
    try { return JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8')).mcpServers?.[MCP_NAME]?.url } catch { return undefined }
  }

  async #claude(...args) {
    const claude = await which('claude', { nothrow: true })
    if (!claude) throw new Error(`Claude Code's CLI isn't on the PATH. Run it yourself: claude mcp ${args.join(' ')}`)
    // @windows an npm-installed CLI is a .cmd, which only a shell can run
    const cmd = /\.(cmd|bat)$/i.test(claude)
    try {
      await run(cmd ? `"${claude}"` : claude, ['mcp', ...args], { shell: cmd, timeout: 30_000, windowsHide: true })
    } catch (err) {
      throw new Error(`claude mcp ${args[0]} failed: ${(err.stderr || err.stdout || err.message).trim()}`)
    }
  }
}
