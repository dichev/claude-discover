/*
  Opens links coming from another app (e.g. a browser):
    claude-discover://session?id=<sessionId>&date=<yyyy-MM-dd>

  Windows only for now (macOS needs a packaged .app bundle, Linux a .desktop file)
    reg query  "HKCU\Software\Classes\claude-discover\shell\open\command"  # auto-register
    reg delete "HKCU\Software\Classes\claude-discover" /f                  # unregister
*/

import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { IS_EPHEMERAL } from '../paths.js'


const SCHEME = 'claude-discover'

export class DeepLink extends EventEmitter {
  #pending = null

  // Call at startup, before app.whenReady(). Returns false when another instance already holds the
  // lock — the caller must then quit, our argv has been forwarded to the window that owns it.
  requestLock() {
    if (!app.requestSingleInstanceLock()) return false
    app.on('second-instance', (_e, argv) => this.emit('open', findTarget(argv)))
    this.#register()
    this.#pending = findTarget(process.argv)
    return true
  }

  takePending() {
    const target = this.#pending
    this.#pending = null
    return target
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
