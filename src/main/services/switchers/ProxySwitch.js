// Start/stop the request-capture proxy (bin/proxy.mjs) and the settings.json env keys pointing
// Claude Code at it. Backs the StatusBar's status + Activate/Deactivate button; sole owner of that config.
import which from 'which'
import { ClaudeSettings } from '../ClaudeSettings.js'
import { LoginService } from '../LoginService.js'
import { PROXY_PATH } from '../../paths.js'
import { PROXY_URL, UPSTREAM, PING_ROUTE, PING_RESPONSE, EXIT_ROUTE, ERROR_LOG_PATH } from '../../../../bin/proxy.config.js'

// Login services get a bare PATH (launchd, systemd), so pass node's absolute path — the app's own
// PATH has it, whichever way the app was launched
const NODE = await which('node', { nothrow: true }) ?? 'node'

export class ProxySwitch {
  #service = new LoginService({ name: 'claude-discover-proxy', command: [NODE, PROXY_PATH] })

  constructor() {
    try { // remove the SessionStart hook of ≤1.9.3 — its script no longer ships and would fail on every session start
      const settings = new ClaudeSettings()
      if (settings.removeHooks(/claude-discover/).length) settings.save()
    } catch {}
  }

  async status() {
    return {
      running: await this.#running(),
      configured: new ClaudeSettings().env?.ANTHROPIC_BASE_URL === PROXY_URL
    }
  }

  // Install the proxy as a login service, then point Claude Code at it — only once it answers, so
  // a failed start never touches settings.json. Throws on failure (Switchers turns that into { error }).
  async activate() {
    const settings = new ClaudeSettings() // fresh — settings.json may have changed since app launch
    const baseUrl = settings.env?.ANTHROPIC_BASE_URL
    if (baseUrl && baseUrl !== PROXY_URL) // never overwrite a foreign base URL (custom gateway)
      throw new Error(`Leaving your existing env.ANTHROPIC_BASE_URL in place (${baseUrl}) — remove it from settings.json to enable capture.`)
    // The proxy listens even with no network, so check the upstream here for a clear error instead of 502s later
    try { await fetch(new URL('/v1/models', UPSTREAM), { signal: AbortSignal.timeout(5000) }) }
    catch { throw new Error('Cannot reach api.anthropic.com — not enabling capture. Check your network and try again.') }
    await this.#exit() // replace a running instance so the service owns it and it runs the current code
    await this.#service.install()
    if (!await this.#settle(true)) {
      await this.#service.uninstall().catch(() => {})
      throw new Error(`Proxy did not start — see ${ERROR_LOG_PATH}`)
    }
    settings.setEnv('ANTHROPIC_BASE_URL', PROXY_URL)
    // Claude Code turns Tool Search off under a custom base URL (most proxies can't forward
    // `tool_reference` blocks); ours forwards verbatim, so turn it back on — it saves ~27k tokens
    // per request. https://code.claude.com/docs/en/env-vars
    settings.setEnv('ENABLE_TOOL_SEARCH', 'true')
    settings.save()
  }

  // Stop the proxy, remove the service and our env keys — a foreign base URL is left alone
  async deactivate() {
    await this.#exit()
    await this.#service.uninstall()
    const settings = new ClaudeSettings()
    if (settings.env?.ANTHROPIC_BASE_URL === PROXY_URL) {
      settings.deleteEnv('ANTHROPIC_BASE_URL')
      settings.deleteEnv('ENABLE_TOOL_SEARCH')
      settings.save()
    }
  }

  // Ask a running instance to exit via its control route and wait for the port to free up
  async #exit() {
    try { await fetch(`${PROXY_URL}${EXIT_ROUTE}`, { method: 'POST', signal: AbortSignal.timeout(1000) }) } catch { return } // not running is fine
    await this.#settle(false)
  }

  async #running() {
    try {
      const res = await fetch(`${PROXY_URL}${PING_ROUTE}`, { signal: AbortSignal.timeout(1000) })
      return res.ok && (await res.text()) === PING_RESPONSE
    } catch { return false }
  }

  // Poll up to 8s until ping matches `target` (the service takes a moment to start it)
  async #settle(target) {
    for (let i = 0; i < 40; i++) {
      if (await this.#running() === target) return true
      await new Promise(r => setTimeout(r, 200))
    }
    return false
  }
}
