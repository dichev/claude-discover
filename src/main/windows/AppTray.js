import { app, Menu, Tray, nativeImage } from 'electron'
import { config } from '../config/ConfigFile.js'

const NAME = 'Claude Discover'

// Keeps the app running after its window closes, behind a tray icon that shows it again (keepInTray in config.json, on unless turned off).
// While the icon is up, closing the window only hides it, so what's on screen is still there when it comes back.
// @linux a desktop with no tray (stock GNOME) shows no icon: launching the app again shows the window, whose File → Quit still quits.
export class AppTray {
  #window
  #tray = null

  constructor({ window }) {
    this.#window = window
  }

  get enabled() { return !!this.#tray }

  start() {
    // A quit has to get past the hidden window: app.quit() gives up when one refuses to close, and an update's install waits on it
    app.on('before-quit', () => this.#hide())
    if (config.read().keepInTray ?? true) this.#show()
  }

  set(enabled) {
    config.save({ keepInTray: enabled })
    if (enabled) this.#show()
    else this.#hide()
  }

  #show() {
    this.#window.hideOnClose = true
    this.#tray = new Tray(icon())
    this.#tray.setToolTip(NAME)
    this.#tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Open ${NAME}`, click: () => this.#window.focus() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]))
    // The menu is on the right button, so a click is free to show and hide the window. @macOS a click opens the menu instead
    if (process.platform !== 'darwin') this.#tray.on('click', () => this.#window.toggle())
  }

  #hide() {
    this.#window.hideOnClose = false
    this.#tray?.destroy()
    this.#tray = null
  }
}

// Drawn here, as the app has no icon file and the main bundle ships as a single one. Grey reads on a dark and on a light
// taskbar, and is the same bytes in either channel order
function icon() {
  const BARS  = [[1, 1, 9], [5, 6, 10], [3, 11, 8]] // a timeline's bars on a 16px grid: x, y, width, each 3px tall
  const GREY  = Buffer.from([0x90, 0x90, 0x90, 0xff])
  const image = nativeImage.createEmpty()
  for (const scale of [1, 2]) {
    const size   = 16 * scale
    const pixels = Buffer.alloc(size * size * 4)
    for (const [x, y, width] of BARS) {
      for (let row = y * scale; row < (y + 3) * scale; row++) {
        pixels.fill(GREY, (row * size + x * scale) * 4, (row * size + (x + width) * scale) * 4)
      }
    }
    image.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: pixels })
  }
  image.setTemplateImage(true) // @macOS the menu bar colors it itself
  return image
}
