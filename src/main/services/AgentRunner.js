import { query } from '@anthropic-ai/claude-agent-sdk'
import {readFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {userInfo} from 'node:os'
import { parseISO } from 'date-fns'
import {CLAUDE_CREDENTIALS} from '../paths.js'


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


  async usage(){
    const token = await this.readOAuthToken()

    // Unofficial Anthropic API — used internally by Claude Code, may change without notice.
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {Authorization: `Bearer ${token}`},
    })


    const json = await res.json()
    return {
      five_hour: { utilization: json.five_hour.utilization, resets_at: parseISO(json.five_hour.resets_at) },
      seven_day: { utilization: json.seven_day.utilization, resets_at: parseISO(json.seven_day.resets_at) },
      _raw_response: json,
    }
  }

  async readOAuthToken() {
    let raw
    if (process.platform === 'darwin') { // @macOS: stores credentials in Keychain
      const execFileAsync = promisify(execFile)
      const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-a', userInfo().username, '-w'])
      raw = stdout.trim()
    } else { // @Windows/Linux
      raw = await readFile(CLAUDE_CREDENTIALS, 'utf8')
    }
    return JSON.parse(raw).claudeAiOauth.accessToken
  }
}
