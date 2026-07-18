// One generic surface for the on/off features behind the StatusBar switches (StatusSwitch.jsx).
// Each *Switch holds the feature logic and simply throws a friendly message on failure — #attempt
// maps every outcome to the { ...status, error? } shape the renderer alerts and renders.
import { ProxySwitch } from './ProxySwitch.js'
import { StatuslineSwitch } from './StatuslineSwitch.js'
import { RetentionSwitch } from './RetentionSwitch.js'

export class Switchers {
  #switches = {
    proxy:      new ProxySwitch(),
    statusline: new StatuslineSwitch(),
    retention:  new RetentionSwitch(),
  }

  status(name)     { return this.#get(name).status() }
  activate(name)   { return this.#attempt(name, s => s.activate()) }
  deactivate(name) { return this.#attempt(name, s => s.deactivate()) }

  // Resolved outside #attempt's try — an unknown name is a bug, thrown raw to IPC, not a toggle error
  #get(name) {
    if (!this.#switches[name]) throw new Error(`Unknown switch: ${name}`)
    return this.#switches[name]
  }

  async #attempt(name, fn) {
    const sw = this.#get(name)
    try {
      await fn(sw)
      return sw.status()
    } catch (err) {
      return { ...await sw.status(), error: String(err?.message || err) }
    }
  }
}
