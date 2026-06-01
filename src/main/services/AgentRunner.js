import { query } from '@anthropic-ai/claude-agent-sdk'


export class AgentRunner {

  async run(text, sender, systemTools = false) {
    const send = chunk => {
      if (!sender.isDestroyed()) sender.send('agent:output', chunk)
    }

    const response = query({
      prompt: text,
      options: {
        includePartialMessages: true,
        env: { ...process.env, FORCE_PROMPT_CACHING_5M: '1' },  // process.env must be included (for macOS)
        tools: systemTools ? undefined : [],
        settingSources: systemTools ? undefined : [],
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
}
