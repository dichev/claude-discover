// One generic surface for the on/off features behind the StatusBar switches (StatusSwitch.jsx).
// Each *Switch holds the feature logic and simply throws a friendly message on failure — #attempt
// maps every outcome to the { ...status, error? } shape the renderer alerts and renders.
import { ProxySwitch } from './ProxySwitch.js'
import { StatuslineSwitch } from './StatuslineSwitch.js'
import { RetentionSwitch } from './RetentionSwitch.js'
import { ClaudeDirSwitch } from './ClaudeDirSwitch.js'
export class Switchers {
  #switches = {
    proxy:      new ProxySwitch(),
    statusline: new StatuslineSwitch(),
    retention:  new RetentionSwitch(),
    claudedir:  new ClaudeDirSwitch(),
  }
  #keepActive = { proxy: true, statusline: true } // toggle feature persisting on app quit

  async status(name) {
    const s = await this.#get(name).status()
    return name in this.#keepActive ? { ...s, keepActive: this.#keepActive[name] } : s
  }

  activate(name)   { return this.#attempt(name, s => s.activate()) }
  deactivate(name) { return this.#attempt(name, s => s.deactivate()) }
  setKeepActive(name, value) { return this.#attempt(name, () => this.#keepActive[name] = !!value) }

  // Deactivate every switch not marked keep-active
  async deactivateOnQuit() {
    for (const name in this.#keepActive) {
      if (!this.#keepActive[name]) await this.deactivate(name)
    }
  }

  // Resolved outside #attempt's try — an unknown name is a bug, thrown raw to IPC, not a toggle error
  #get(name) {
    if (!this.#switches[name]) throw new Error(`Unknown switch: ${name}`)
    return this.#switches[name]
  }

  async #attempt(name, fn) {
    const sw = this.#get(name)
    try {
      await fn(sw)
      return this.status(name)
    } catch (err) {
      return { ...await this.status(name), error: String(err?.message || err) }
    }
  }
}
