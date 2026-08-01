// Opens claude-discover://session?id=<sessionId>&date=<yyyy-MM-dd> links from other apps.
// Routing is shared; only the scheme registration is OS-specific.
//
// @windows  registered on every launch (#register) — the link arrives in a second launch's argv
//           reg delete "HKCU\Software\Classes\claude-discover" /f   # unregister
// @macOS    declared in the packaged .app's plist — arrives as an `open-url` event
//           node test/scripts/package-mac.mjs                       # rebuild + register

import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { IS_EPHEMERAL } from '../paths.js'


const SCHEME = 'claude-discover'

export class DeepLink extends EventEmitter {
  #pending = null
  #live    = false // the renderer has pulled the cold-start link, so later links can be pushed to it

  // Call at startup, before app.whenReady(). Returns false when another instance already holds the
  // lock — the caller must then quit, our argv has been forwarded to the window that owns it.
  requestLock() {
    if (!app.requestSingleInstanceLock()) return false
    app.on('second-instance', (_e, argv) => this.emit('open', findTarget(argv)))
    app.on('open-url', (e, url) => { e.preventDefault(); this.#deliver(findTarget([url])) }) // @macOS
    this.#register()
    this.#pending = findTarget(process.argv)
    return true
  }

  takePending() {
    this.#live = true
    const target = this.#pending
    this.#pending = null
    return target
  }

  // @macOS Launch Services reuses the running bundle instead of launching a second process, so links
  // come as events — and a cold-start one fires before the renderer exists, hence the park.
  #deliver(target) {
    if (!target) return
    if (this.#live) this.emit('open', target)
    else this.#pending = target
  }

  // @windows Rewritten on every launch — idempotent, and the last launched checkout wins.
  #register() {
    if (process.platform !== 'win32') return
    if (IS_EPHEMERAL) return // an npx cache dir is deleted later — registering it leaves a dead handler
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [app.getAppPath()])
  }
}

// Only the query params are read. The `session` host is there to make the link readable, but it's
// not matched — Windows hands it to us rewritten as `session/`, so matching it would need both forms.
function findTarget(argv) {
  const link = URL.parse(argv.find(a => a.startsWith(`${SCHEME}://`)) ?? '') // null when absent or unreadable
  const id = link?.searchParams.get('id')
  return id ? { id, date: link.searchParams.get('date') } : null
}
