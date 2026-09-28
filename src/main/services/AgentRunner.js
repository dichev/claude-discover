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
}
