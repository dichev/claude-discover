// AppTray keeps the app running behind a tray icon: while the icon is up the window hides on close. These tests pin that
// this follows the saved choice, that the icon leads back to the window, and that a quit always gets through.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { saved, trays, hints } = vi.hoisted(() => ({ saved: {}, trays: [], hints: [] }))
vi.mock('../src/main/config/ConfigFile.js', () => ({ config: { read: () => saved, save: data => Object.assign(saved, data) } }))
vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: vi.fn() },
  Menu: { buildFromTemplate: items => items },
  Notification: class { static isSupported() { return true } constructor(hint) { this.hint = hint } show() { hints.push(this.hint) } },
  nativeImage: { createEmpty: () => ({ addRepresentation() {}, setTemplateImage() {} }) },
  Tray: class {
    handlers = {}
    constructor() { trays.push(this) }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu }
    on(event, handler) { this.handlers[event] = handler }
    destroy() { trays.splice(trays.indexOf(this), 1) }
  },
}))

import { app } from 'electron'
import { AppTray } from '../src/main/windows/AppTray.js'

// the app as launched with what config.json holds
function launch() {
  const window = { focus: vi.fn(), toggle: vi.fn(), closeToTray: null }
  const tray = new AppTray({ window })
  tray.start()
  return { tray, window }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete saved.keepInTray
  delete saved.trayHintShown
  trays.length = 0
  hints.length = 0
})

describe('AppTray', () => {
  it('is on from the first launch, until turned off, and remembers either', () => {
    const { tray, window } = launch()
    expect([tray.enabled, !!window.closeToTray, trays.length]).toEqual([true, true, 1])

    tray.set(false)
    expect([tray.enabled, window.closeToTray, trays.length]).toEqual([false, null, 0])
    expect(launch().tray.enabled).toBe(false)

    tray.set(true)
    expect(launch().tray.enabled).toBe(true)
  })

  it('shows or hides the window on a click of the icon, and only opens it from the menu', () => {
    const { window } = launch()
    trays[0].handlers.click()
    expect(window.toggle).toHaveBeenCalledTimes(1)
    trays[0].menu.find(item => item.label?.startsWith('Open')).click()
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it('says it is still running on the first close only, on this launch and the next', () => {
    launch().window.closeToTray()
    launch().window.closeToTray()
    expect(hints).toHaveLength(1)
    expect(hints[0].title).toMatch(/still running/)
  })

  it('lets a quit through: its menu quits for real, and a quit under way stops hiding the window', () => {
    const { window } = launch()
    trays[0].menu.find(item => item.label === 'Quit').click()
    expect(app.quit).toHaveBeenCalled()
    app.on.mock.calls.find(([event]) => event === 'before-quit')[1]()
    expect([window.closeToTray, trays.length]).toEqual([null, 0])
  })
})
