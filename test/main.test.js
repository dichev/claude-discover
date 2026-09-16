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
vi.mock('../src/main/paths.js', () => ({ IS_EPHEMERAL: false }))
const restart = vi.fn()
vi.mock('../src/main/Application.js', () => ({ Application: class {
  start() {}
  restart = restart
} }))
vi.mock('../src/main/debug.js', () => ({}))

import { app } from 'electron'

const LINK = 'claude-discover://session?id=abc123&date=2026-07-23'

// runs main.js afresh as `electron.exe . <args>`
async function launch(args = [], { lock = true } = {}) {
  app.requestSingleInstanceLock.mockReturnValue(lock)
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
