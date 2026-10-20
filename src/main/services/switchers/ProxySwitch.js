// Start/stop the request-capture proxy (bin/proxy.mjs) and the settings.json env keys pointing
// Claude Code at it. Backs the StatusBar's status + Activate/Deactivate button; sole owner of that config.
// The desktop app's Code tab isn't covered: it injects its own ANTHROPIC_BASE_URL, which beats settings.json —
// waiting on https://github.com/anthropics/claude-code/issues/97574
import which from 'which'
import { ClaudeSettings } from '../ClaudeSettings.js'
import { LoginService } from '../LoginService.js'
import { PROXY_PATH } from '../../paths.js'
import { PROXY_URL, UPSTREAM, PING_ROUTE, PING_RESPONSE, EXIT_ROUTE, ERROR_LOG_PATH } from '../../../../bin/proxy.config.js'

// Login services get a bare PATH (launchd, systemd), so pass node's absolute path — the app's own
// PATH has it, whichever way the app was launched
const NODE = await which('node', { nothrow: true }) ?? 'node'

// Running sessions pick up a settings.json env change ~1 request late, so keep serving that request
const SETTINGS_RELOAD_GRACE_MS = 3000

export class ProxySwitch {
  #service = new LoginService({ name: 'claude-discover-proxy', command: [NODE, PROXY_PATH] })

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
    if (!await this.#exit()) // replace a running instance so the service owns it and it runs the current code
      throw new Error(`The running proxy on ${PROXY_URL} did not exit — try again.`)
    await this.#service.install()
    if (!await this.#settle(true)) {
      await this.#service.uninstall().catch(() => {})
      throw new Error(`Proxy did not start — see ${ERROR_LOG_PATH}`)
    }
    settings.setEnv('ANTHROPIC_BASE_URL', PROXY_URL)
    settings.save()
  }

  // Remove our env keys, then stop the proxy and remove the service — a foreign base URL is left alone
  async deactivate() {
    const settings = new ClaudeSettings()
    if (settings.env?.ANTHROPIC_BASE_URL === PROXY_URL) {
      // Blank, not delete: running sessions apply changed env values live but keep removed ones,
      // so a deleted key would leave them on the dead port. "" counts as unset (default endpoint)
      settings.setEnv('ANTHROPIC_BASE_URL', '')
      settings.deleteEnv('ENABLE_TOOL_SEARCH') // older app versions set it; Claude Code 2.1.304+ has it on by default
      settings.save()
      await new Promise(r => setTimeout(r, SETTINGS_RELOAD_GRACE_MS))
    }
    const exited = await this.#exit()
    await this.#service.uninstall()
    if (!exited) throw new Error(`The proxy on ${PROXY_URL} did not exit and still holds the port.`)
  }

  // Ask a running instance to exit via its control route; true once the port is free
  async #exit() {
    // A failed request means not running, or too busy to answer in time — the ping below tells which
    try { await fetch(`${PROXY_URL}${EXIT_ROUTE}`, { method: 'POST', signal: AbortSignal.timeout(1000) }) } catch {}
    return this.#settle(false)
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
