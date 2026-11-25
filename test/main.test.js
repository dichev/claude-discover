// main.js is the startup entry: the single-instance lock decides whether this process runs the app or
// hands its argv to the running one and exits. These tests pin both sides of that handshake.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({ app: {
  requestSingleInstanceLock: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
  on: vi.fn(),
  exit: vi.fn(),
  setAsDefaultProtocolClient: vi.fn(),
  getAppPath: () => 'C:\\repo',
} }))
// stands in for LAUNCH_MODE, flipped per launch — a getter, so it reads this at call time
const paths = { ephemeral: false }
vi.mock('../src/main/paths.js', () => ({ LAUNCH_MODES: { NPX_TEMP: 'npx-temp' }, get LAUNCH_MODE() { return paths.ephemeral ? 'npx-temp' : 'npm-start' } }))
const restart = vi.fn()
const created = vi.fn() // the options each Application was built with
vi.mock('../src/main/Application.js', () => ({ Application: class {
  constructor(options) { created(options) }
  start() {}
  restart = restart
} }))
vi.mock('../src/main/debug.js', () => ({}))
vi.mock('electron-update-from-npm', () => ({ NpmUpdater: class { createShortcuts() {} } }))

import { app } from 'electron'

const LINK = 'claude-discover://session?id=abc123&date=2026-07-23'

// runs main.js afresh as `electron.exe . <args>`
async function launch(args = [], { lock = true, ephemeral = false } = {}) {
  app.requestSingleInstanceLock.mockReturnValue(lock)
  paths.ephemeral = ephemeral
  const [argv, plat] = [process.argv, Object.getOwnPropertyDescriptor(process, 'platform')]
  process.argv = ['electron.exe', '.', ...args]
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  try {
    vi.resetModules()
    await import('../src/main/main.js')
    await new Promise(r => setTimeout(r)) // let whenReady build the Application
  } finally {
    process.argv = argv
    Object.defineProperty(process, 'platform', plat)
  }
}

beforeEach(() => vi.clearAllMocks())

describe('single instance', () => {
  it('restarts onto the new build when a second launch says --restart', async () => {
    await launch()
    const secondInstance = app.on.mock.calls.find(([event]) => event === 'second-instance')[1]
    secondInstance({}, ['electron.exe', '.', '--restart'])
    expect(restart).toHaveBeenCalled()
  })

  it('touches nothing when another instance owns the lock', async () => {
    await launch([LINK], { lock: false })
    expect(app.exit).toHaveBeenCalledWith(0)
    expect(app.on).not.toHaveBeenCalled()
    expect(app.whenReady).not.toHaveBeenCalled()
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })
})

// An npx run is a tryout: closing its window must quit it, so it's built with no tray to stay behind in
describe('tray', () => {
  it.each([
    ['an install can keep running in it', false, true],
    ['an npx run gets none', true, false],
  ])('%s', async (_why, ephemeral, withTray) => {
    await launch([], { ephemeral })
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ withTray }))
  })
})
