import { app } from 'electron'
import { DeepLink, findTarget } from './services/DeepLink.js'
import { Application } from './Application.js'

// The first instance takes control: it owns the window and handles links and restart requests.
// Later instances forward their argv to it via 'second-instance', then exit.
const isFirstInstance = app.requestSingleInstanceLock()

if (isFirstInstance) {
  let application
  const deepLink = new DeepLink()
  deepLink.activate()

  if (import.meta.env.DEV) await import('./debug.js')
  app.whenReady().then(() => {
    application = new Application({ deepLink })
    application.start()
  })

  app.on('second-instance', (_e, argv) => {
    const target = findTarget(argv)
    if (argv.includes('--restart')) {
      app.relaunch()
      app.quit()
    } else if (target) {
      deepLink.open(target)
    } else {
      application?.win.focus()
    }
  })
}
else {
  app.exit(0)
}
