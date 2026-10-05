import { withTimeout } from '../utils.js'

const USAGE_TIMEOUT = 30_000 // a hung session is closed, not left running while the next refresh spawns another

export class AgentRunner {

  async run(text, sender) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk') // loaded on first run — 50ms off startup
    const send = chunk => {
      if (!sender.isDestroyed()) sender.send('agent:output', chunk)
    }

    const response = query({
      prompt: text,
      options: {
        includePartialMessages: true,
        env: { ...process.env, DISABLE_PROMPT_CACHING: '1' }, // @macOS - process.env must be included
        tools: [],
        settingSources: [],
      }
    })
    for await (const message of response) {
      if (message.type === 'stream_event') {
        const delta = message.event.delta
        if (delta?.type === 'text_delta' && delta.text) send(delta.text)
      } else if (message.type === 'result') {
        return { code: message.is_error ? 1 : 0 }
      }
    }
    return { code: 0 }
  }

  // The structured /usage data, from a session that's closed whether it answers, fails or hangs
  async usage() {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    // An empty prompt stream: control requests need streaming mode, and no message means no tokens spent
    const q = query({ prompt: (async function* () {})(), options: { tools: [], settingSources: [] } })
    const usage = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
    return withTimeout(usage, USAGE_TIMEOUT, () => q.close())
  }
}
