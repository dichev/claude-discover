// Start/stop the request-capture proxy (bin/proxy.mjs) and the settings.json
// env keys pointing Claude Code at it. Backs the StatusBar's status + Activate/Deactivate
// button; sole owner of that config.
import { spawn } from 'node:child_process'
import { ClaudeSettings } from '../ClaudeSettings.js'
import { PROXY_PATH, CLAUDE_HOOKS_PATH } from '../../paths.js'
import { PROXY_URL, PING_ROUTE, PING_RESPONSE, EXIT_ROUTE, ERROR_LOG_PATH } from '../../../../bin/proxy.config.js'

const HOOK_BASENAME = 'hooks.mjs' // also matches the retired claude-hooks.mjs name, repairing it in place
const HOOK_COMMAND = `node "${CLAUDE_HOOKS_PATH}"`

export class ProxySwitch {

  async status() {
    return {
      running: await this.#running(),
      configured: new ClaudeSettings().env?.ANTHROPIC_BASE_URL === PROXY_URL
    }
  }

  // Spawn the proxy detached (it outlives the app) and point Claude Code at it only once it's
  // confirmed listening — a failed start never changes settings.json. The proxy verifies the
  // upstream itself before listening (exit code 2 when unreachable), so a successful start
  // proves end-to-end connectivity. Failures throw; Switchers maps them to { error }.
  async activate() {
    const settings = new ClaudeSettings() // fresh — settings.json may have changed since app launch
    const baseUrl = settings.env?.ANTHROPIC_BASE_URL
    if (baseUrl && baseUrl !== PROXY_URL) // never overwrite a foreign base URL (custom gateway)
      throw new Error(`Leaving your existing env.ANTHROPIC_BASE_URL in place (${baseUrl}) — remove it from settings.json to enable capture.`)
    // ELECTRON_RUN_AS_NODE runs the script with Electron's own binary — no system `node` required
    const child = spawn(process.execPath, [PROXY_PATH, '--restart'], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    const exited = new Promise(resolve => child.once('exit', resolve)) // still fires while the app lives
    child.unref()
    const outcome = await Promise.race([exited, this.#settle(true).then(ok => ok ? 'up' : 'unresponsive')])
    if (outcome !== 'up')
      throw new Error(outcome === 2
        ? 'Cannot reach api.anthropic.com — not enabling capture. Check your network and try again.'
        : `Proxy did not start — see ${ERROR_LOG_PATH}`)
    const hook = settings.findHook('SessionStart', HOOK_BASENAME)
    if (!baseUrl || settings.env?.ENABLE_TOOL_SEARCH !== 'true' || hook?.command !== HOOK_COMMAND) {
      settings.setEnv('ANTHROPIC_BASE_URL', PROXY_URL)
      // Claude Code disables Tool Search under a custom base URL (most proxies can't forward
      // `tool_reference` blocks); ours forwards verbatim to real Anthropic, so re-enable it
      // to keep the ~27k tokens/request savings. https://code.claude.com/docs/en/env-vars
      settings.setEnv('ENABLE_TOOL_SEARCH', 'true')
      if (hook?.command !== HOOK_COMMAND) {
        // SessionStart hook revives the proxy after a PC restart/crash — the env keys survive
        // but the process doesn't, which would otherwise leave Claude Code pointed at a dead port.
        settings.removeHook('SessionStart', HOOK_BASENAME) // repair a stale absolute path in place
        settings.addHook('SessionStart', HOOK_COMMAND)
      }
      settings.save()
    }
  }

  // Exit the proxy via its control route and remove the env keys + revive hook — env keys only
  // when the base URL is ours, so a foreign gateway config is never touched.
  async deactivate() {
    try { await fetch(`${PROXY_URL}${EXIT_ROUTE}`, { method: 'POST', signal: AbortSignal.timeout(1000) }) } catch {} // already stopped is fine
    const settings = new ClaudeSettings()
    const ours = settings.env?.ANTHROPIC_BASE_URL === PROXY_URL
    const removedHook = settings.removeHook('SessionStart', HOOK_BASENAME).length > 0
    if (ours) {
      settings.deleteEnv('ANTHROPIC_BASE_URL')
      settings.deleteEnv('ENABLE_TOOL_SEARCH')
    }
    if (ours || removedHook) settings.save()
    await this.#settle(false)
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
