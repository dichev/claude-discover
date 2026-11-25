import { app } from 'electron'
import { DeepLink, findTarget } from './services/DeepLink.js'
import { Application } from './Application.js'
import { updater } from './updater.js'
import { LAUNCH_MODE, LAUNCH_MODES } from './paths.js'

if (import.meta.env.DEV) await import('./debug.js')  // note dev uses a separate userData profile

// The first instance takes control: it owns the window and handles links and restart requests.
// Later instances forward their argv to it via 'second-instance', then exit.
const isFirstInstance = app.requestSingleInstanceLock()

if (isFirstInstance) {
  let application = null
  let deepLink = null
  optional('deep links', () => deepLink = new DeepLink().activate())
  updater.createShortcuts({ appId: 'com.dichev.claude-discover', name: 'Claude Discover', description: 'Browse your local Claude Code sessions' }) // never throws

  app.whenReady().then(() => {
    // An npx run is a tryout that mustn't be left running by surprise: it gets no tray, nor the choice of one
    application = new Application({ deepLink, withTray: LAUNCH_MODE !== LAUNCH_MODES.NPX_TEMP })
    application.start()
  })

  app.on('second-instance', (_e, argv) => {
    const target = findTarget(argv)
    if (argv.includes('--restart')) {
      application?.restart()
    } else if (target) {
      deepLink?.open(target)
    } else {
      application?.win.focus()
    }
  })
}
else {
  app.exit(0)
}

// Add-ons that must never block startup
function optional(label, activate) {
  try { activate() } catch (err) { console.warn(`[${label}] skipped:`, err.message) }
}
