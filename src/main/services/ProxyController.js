// Start/stop the request-capture proxy (bin/capture-requests-proxy.mjs) and the settings.json
// env keys pointing Claude Code at it. Backs the StatusBar's status + Start/Stop button; sole
// owner of that config — bin/setup-hook.mjs deliberately doesn't touch it.
import { spawn } from 'node:child_process'
import { ClaudeSettings } from './ClaudeSettings.js'
import { PROXY_PATH, PROXY_URL } from '../paths.js'
import { PING_ROUTE, PING_RESPONSE, EXIT_ROUTE, ERROR_LOG_PATH } from '../../../bin/capture-requests-proxy.mjs'

export class ProxyController {

  async status() {
    return {
      running: await this.#running(),
      configured: new ClaudeSettings().env?.ANTHROPIC_BASE_URL === PROXY_URL
    }
  }

  // Spawn the proxy detached (it outlives the app) and point Claude Code at it only once it's
  // confirmed listening — a failed start never changes settings.json. The proxy verifies the
  // upstream itself before listening (exit code 2 when unreachable), so a successful start
  // proves end-to-end connectivity.
  async start() {
    try {
      const settings = new ClaudeSettings() // fresh — settings.json may have changed since app launch
      const baseUrl = settings.env?.ANTHROPIC_BASE_URL
      if (baseUrl && baseUrl !== PROXY_URL) // never overwrite a foreign base URL (custom gateway)
        return this.#fail(`Leaving your existing env.ANTHROPIC_BASE_URL in place (${baseUrl}) — remove it from settings.json to enable capture.`)
      // ELECTRON_RUN_AS_NODE runs the script with Electron's own binary — no system `node` required
      const child = spawn(process.execPath, [PROXY_PATH, '--restart'], {
        detached: true, stdio: 'ignore', windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      })
      const exited = new Promise(resolve => child.once('exit', resolve)) // still fires while the app lives
      child.unref()
      const outcome = await Promise.race([exited, this.#settle(true).then(ok => ok ? 'up' : 'unresponsive')])
      if (outcome !== 'up')
        return this.#fail(outcome === 2
          ? 'Cannot reach api.anthropic.com — not enabling capture. Check your network and try again.'
          : `Proxy did not start — see ${ERROR_LOG_PATH}`)
      if (!baseUrl || settings.env?.ENABLE_TOOL_SEARCH !== 'true') {
        settings.setEnv('ANTHROPIC_BASE_URL', PROXY_URL)
        // Claude Code disables Tool Search under a custom base URL (most proxies can't forward
        // `tool_reference` blocks); ours forwards verbatim to real Anthropic, so re-enable it
        // to keep the ~27k tokens/request savings. https://code.claude.com/docs/en/env-vars
        settings.setEnv('ENABLE_TOOL_SEARCH', 'true')
        settings.save()
      }
      return this.status()
    } catch (err) {
      return this.#fail(String(err?.message || err))
    }
  }

  // Exit the proxy via its control route and remove the env keys — only when the base URL is
  // ours, so a foreign gateway config is never touched.
  async stop() {
    try {
      try { await fetch(`${PROXY_URL}${EXIT_ROUTE}`, { method: 'POST', signal: AbortSignal.timeout(1000) }) } catch {} // already stopped is fine
      const settings = new ClaudeSettings()
      if (settings.env?.ANTHROPIC_BASE_URL === PROXY_URL) {
        settings.deleteEnv('ANTHROPIC_BASE_URL')
        settings.deleteEnv('ENABLE_TOOL_SEARCH')
        settings.save()
      }
      await this.#settle(false)
      return this.status()
    } catch (err) {
      return this.#fail(String(err?.message || err))
    }
  }

  async #fail(error) {
    return { ...await this.status(), error }
  }

  async #running() {
    try {
      const res = await fetch(`${PROXY_URL}${PING_ROUTE}`, { signal: AbortSignal.timeout(1000) })
      return res.ok && (await res.text()) === PING_RESPONSE
    } catch { return false }
  }

  // Poll (≤8s — the proxy's startup upstream check can take 5s) until ping matches `target`
  async #settle(target) {
    for (let i = 0; i < 40; i++) {
      if (await this.#running() === target) return true
      await new Promise(r => setTimeout(r, 200))
    }
    return false
  }
}
