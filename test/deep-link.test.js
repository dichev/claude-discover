// DeepLink turns a `claude-discover://session?id=…&date=…` link into a { id, date } target. These
// tests pin the delivery paths — a cold-start link parked for the renderer to pull, a second launch
// or a macOS `open-url` emitted as `open` — plus the scheme registration.
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: {
  on: vi.fn(),
  setAsDefaultProtocolClient: vi.fn(),
  getAppPath: () => 'C:\\repo', // an opaque token — only ever echoed back in an assertion
} }))
// stands in for IS_EPHEMERAL, flipped per launch — a getter, so it reads this at call time, long
// after the hoisted mock factory has run
const paths = { ephemeral: false }
vi.mock('../src/main/paths.js', () => ({ get IS_EPHEMERAL() { return paths.ephemeral } }))

import { app } from 'electron'
import { DeepLink, findTarget } from '../src/main/services/DeepLink.js'

const LINK = 'claude-discover://session?id=abc123&date=2026-07-23'
const TARGET = { id: 'abc123', date: '2026-07-23' }

// a DeepLink activated in the first instance, launched as `electron.exe . <args>`
function launch(args = [], { platform = 'win32', ephemeral = false } = {}) {
  vi.clearAllMocks()
  paths.ephemeral = ephemeral
  const [argv, plat] = [process.argv, Object.getOwnPropertyDescriptor(process, 'platform')]
  process.argv = ['electron.exe', '.', ...args]
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    const deepLink = new DeepLink()
    deepLink.activate()
    return { deepLink }
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
  deepLink.open(findTarget(['electron.exe', '.', ...args]))
  return { deepLink, emitted }
}

// a link clicked on macOS: Launch Services reuses the bundle and fires open-url instead of relaunching
function openUrl(url) {
  const event = { preventDefault: vi.fn() }
  app.on.mock.calls.find(([e]) => e === 'open-url')[1](event, url)
  return event
}

describe('delivery', () => {
  it('parks a cold-start link for the renderer to pull, and yields it only once', () => {
    const { deepLink } = launch([LINK])
    const emitted = vi.fn()
    deepLink.on('open', emitted)
    expect(emitted).not.toHaveBeenCalled() // no window exists yet to push to
    expect(deepLink.takePending()).toEqual(TARGET)
    expect(deepLink.takePending()).toBe(null) // a reload must not re-open it
  })

  it('emits a second launch instead of parking it — the renderer is already listening', () => {
    const { deepLink, emitted } = secondLaunch(LINK)
    expect(emitted).toHaveBeenCalledWith(TARGET)
    expect(deepLink.takePending()).toBe(null)
  })

  it('does not emit a link event for a second launch with no link', () => {
    expect(secondLaunch().emitted).not.toHaveBeenCalled()
  })

  it('parks an open-url link until the renderer has pulled, then pushes the next one', () => { // @macOS
    const { deepLink } = launch([], { platform: 'darwin' })
    const emitted = vi.fn()
    deepLink.on('open', emitted)

    const event = openUrl(LINK) // cold start — the window isn't up yet
    expect(event.preventDefault).toHaveBeenCalled() // macOS logs the URL as unhandled otherwise
    expect(emitted).not.toHaveBeenCalled()
    expect(deepLink.takePending()).toEqual(TARGET)

    openUrl(LINK) // the renderer is listening now
    expect(emitted).toHaveBeenCalledWith(TARGET)
    expect(deepLink.takePending()).toBe(null) // pushed, not parked
  })

  it('drops an open-url carrying no session, rather than raising the window', () => { // @macOS
    const { deepLink } = launch([], { platform: 'darwin' })
    const emitted = vi.fn()
    deepLink.on('open', emitted)
    deepLink.takePending() // the renderer is up, so any target would be pushed
    openUrl('claude-discover://session')
    expect(emitted).not.toHaveBeenCalled()
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
    expect(findTarget(['electron.exe', '.', url])).toEqual(expected)
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
