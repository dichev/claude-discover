// DeepLink turns a `claude-discover://session?id=…&date=…` argv into a { id, date } target. These
// tests pin the two delivery paths — a cold-start link parked for the renderer to pull, a second
// launch emitted as `open` — plus the lock handshake and the Windows-only scheme registration.
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: {
  requestSingleInstanceLock: vi.fn(),
  on: vi.fn(),
  setAsDefaultProtocolClient: vi.fn(),
  getAppPath: () => 'C:\\repo', // an opaque token — only ever echoed back in an assertion
} }))
// stands in for IS_EPHEMERAL, flipped per launch — a getter, so it reads this at call time, long
// after the hoisted mock factory has run
const paths = { ephemeral: false }
vi.mock('../src/main/paths.js', () => ({ get IS_EPHEMERAL() { return paths.ephemeral } }))

import { app } from 'electron'
import { DeepLink } from '../src/main/services/DeepLink.js'

const LINK = 'claude-discover://session?id=abc123&date=2026-07-23'
const TARGET = { id: 'abc123', date: '2026-07-23' }

// a DeepLink that has run the lock handshake, launched as `electron.exe . <args>`
function launch(args = [], { lock = true, platform = 'win32', ephemeral = false } = {}) {
  vi.clearAllMocks()
  app.requestSingleInstanceLock.mockReturnValue(lock)
  paths.ephemeral = ephemeral
  const [argv, plat] = [process.argv, Object.getOwnPropertyDescriptor(process, 'platform')]
  process.argv = ['electron.exe', '.', ...args]
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    const deepLink = new DeepLink()
    return { deepLink, primary: deepLink.requestLock() }
  } finally {
    process.argv = argv
    Object.defineProperty(process, 'platform', plat)
  }
}

// a link clicked while we're already running: Electron hands the new argv to the live instance
function secondLaunch(...args) {
  const { deepLink } = launch()
  const emitted = vi.fn()
  deepLink.on('open', emitted)
  app.on.mock.calls.find(([event]) => event === 'second-instance')[1]({}, ['electron.exe', '.', ...args])
  return { deepLink, emitted }
}

describe('delivery', () => {
  it('parks a cold-start link for the renderer to pull, and yields it only once', () => {
    const { deepLink, primary } = launch([LINK])
    const emitted = vi.fn()
    deepLink.on('open', emitted)
    expect(primary).toBe(true)
    expect(emitted).not.toHaveBeenCalled() // no window exists yet to push to
    expect(deepLink.takePending()).toEqual(TARGET)
    expect(deepLink.takePending()).toBe(null) // a reload must not re-open it
  })

  it('emits a second launch instead of parking it — the renderer is already listening', () => {
    const { deepLink, emitted } = secondLaunch(LINK)
    expect(emitted).toHaveBeenCalledWith(TARGET)
    expect(deepLink.takePending()).toBe(null)
  })

  it('emits null for a second launch with no link, so the window is still raised', () => {
    expect(secondLaunch().emitted).toHaveBeenCalledWith(null)
  })

  it('touches nothing when another instance owns the lock', () => {
    const { deepLink, primary } = launch([LINK], { lock: false })
    expect(primary).toBe(false)
    expect(deepLink.takePending()).toBe(null) // requestLock already handed our argv to the primary
    expect(app.on).not.toHaveBeenCalled()
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })
})

describe('link parsing', () => {
  it.each([
    ['claude-discover://session?id=abc123&date=2026-07-23',  TARGET],
    ['claude-discover://session/?id=abc123&date=2026-07-23', TARGET],                 // Windows normalises the host
    ['claude-discover://session?id=abc123',                  { id: 'abc123', date: null }],
    ['claude-discover://session?date=2026-07-23',            null],                   // an id is the one thing required
    ['claude-discover://session',                            null],
    ['claude-discover://[',                                  null],                   // unparseable — ignored, never thrown
    ['https://example.com/?id=nope',                         null],                   // not our scheme
  ])('%s → %j', (url, expected) => {
    expect(secondLaunch(url).emitted).toHaveBeenCalledWith(expected)
  })
})

describe('scheme registration', () => {
  it('points the scheme at this Electron binary and app dir', () => {
    launch()
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('claude-discover', process.execPath, ['C:\\repo'])
  })

  it.each([
    ['other platforms register schemes their own way', { platform: 'darwin' }],
    ['an npx cache dir would soon leave a dead handler', { ephemeral: true }],
  ])('skips it — %s', (_why, options) => {
    launch([], options)
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })
})
