import { withTimeout } from '../utils.js'
import fsp from 'node:fs/promises'
import { CLAUDE_PROJECTS_DIR, DATA_DIR } from '../paths.js'
import { REQUESTS_DIR } from '../../../bin/proxy.config.js'

const USAGE_TIMEOUT = 30_000 // a hung session is closed, not left running while the next refresh spawns another

export class AgentRunner {

  // Chunks carry the run's id: runs for different sessions can stream at the same time
  async run({ id, prompt, systemPrompt, tag }, sender) {
    const { query, tagSession } = await import('@anthropic-ai/claude-agent-sdk') // loaded on first run — 50ms off startup
    const send = chunk => {
      if (!sender.isDestroyed()) sender.send('agent:output', { id, chunk })
    }

    await fsp.mkdir(DATA_DIR, { recursive: true })
    const response = query({
      prompt,
      options: {
        cwd: DATA_DIR, // reads in the cwd are auto-allowed too, so not wherever the app was launched from (e.g. home under npx)
        systemPrompt, // replaces Claude Code's coding-agent prompt, made for editing code
        model: 'claude-opus-5-5',
        effort: 'high',
        includePartialMessages: true,
        env: { ...process.env, DISABLE_PROMPT_CACHING: '1' }, // @macOS - process.env must be included
        // Read-only, for the full text behind the transcript's truncated blocks. Reads inside these dirs (and the
        // cwd) are auto-allowed; anything else reaches canUseTool and is refused
        tools: ['Read', 'Grep'],
        additionalDirectories: [CLAUDE_PROJECTS_DIR, REQUESTS_DIR],
        canUseTool: async () => ({ behavior: 'deny', message: 'Only the session transcripts and proxy logs are readable' }),
        settingSources: [],
        verbatimPrompts: true, // the transcript quotes the user's @file mentions, which would attach today's version of those files
        settings: { autoMemoryEnabled: false }, // the app's cwd memory has nothing to do with the session analyzed
      }
    })
    let tagged
    for await (const message of response) {
      if (message.type === 'stream_event') {
        // The transcript file only exists once the prompt is sent, so the first stream event is the earliest moment to tag it
        tagged ??= tagSession(message.session_id, tag).catch(console.error) // a failed tag shouldn't fail the answer
        const delta = message.event.delta
        if (delta?.type === 'text_delta' && delta.text) send(delta.text)
      } else if (message.type === 'result') {
        await tagged
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
