import { MCP_NAME } from './McpEndpoint.js'

// Backs the MCP tools debug panel: talks to the app's own MCP server over HTTP as Claude Code does, so what it lists and
// returns is exactly what a session gets, schemas and errors included
export class McpClient {
  #endpoint

  constructor(endpoint) {
    this.#endpoint = endpoint
  }

  list() {
    return this.#connect(async client => ({ url: this.#endpoint.url, instructions: client.getInstructions(), tools: (await client.listTools()).tools }))
  }

  call(name, args) {
    return this.#connect(async client => {
      const { content, isError } = await client.callTool({ name, arguments: args })
      return { text: content.map(c => c.text).join('\n'), isError: !!isError }
    })
  }

  async #connect(use) {
    if (!this.#endpoint.running) throw new Error(`The MCP server isn't running (${this.#endpoint.url})`)
    const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([import('@modelcontextprotocol/sdk/client/index.js'), import('@modelcontextprotocol/sdk/client/streamableHttp.js')]) // off startup, as the server's
    const client = new Client({ name: `${MCP_NAME}-debug`, version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(this.#endpoint.url)))
    try { return await use(client) } finally { await client.close() }
  }
}
