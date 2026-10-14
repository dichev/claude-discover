// createShortcuts writes launchers for an `npm i -g` install, once per install, and re-points the ones still there.
// These tests pin when shortcuts are written, that a deleted one stays deleted until the next install, and which
// name and app id each kind of launch gets. They run the @windows flavour on any OS; @macOS needs a real Electron.app.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  dirs: {}, // set per test
  app: { getAppPath: () => mocks.dirs.app, getPath: name => mocks.dirs[name], getName: () => 'my-app', setAppUserModelId: vi.fn() },
  shell: { writeShortcutLink: vi.fn() },
}))
vi.mock('electron', () => ({ app: mocks.app, shell: mocks.shell }))

import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const platform = process.platform
let tmp

function installAt(...segments) {
  mocks.dirs.app = join(tmp, ...segments, 'my-app')
  fs.mkdirSync(mocks.dirs.app, { recursive: true })
  fs.writeFileSync(join(mocks.dirs.app, 'package.json'), JSON.stringify({ name: 'my-app' }))
}

async function launch(options = { appId: 'com.example.my-app', name: 'My App' }) {
  vi.resetModules()
  const { createShortcuts } = await import('../src/shortcuts.js')
  createShortcuts(options)
}

const written = () => mocks.shell.writeShortcutLink.mock.calls.map(([path, mode, { appUserModelId }]) => [basename(path), mode, appUserModelId])

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { value: 'win32' })
  tmp = fs.mkdtempSync(join(tmpdir(), 'shortcuts-'))
  mocks.dirs = { appData: join(tmp, 'appData'), desktop: join(tmp, 'desktop'), userData: join(tmp, 'userData') }
  fs.mkdirSync(join(mocks.dirs.appData, 'Microsoft/Windows/Start Menu/Programs'), { recursive: true })
  fs.mkdirSync(mocks.dirs.desktop)
  mocks.shell.writeShortcutLink.mockImplementation(path => { fs.writeFileSync(path, ''); return true })
  installAt('npm', 'node_modules')
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform })
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('createShortcuts', () => {
  it('creates Start Menu and Desktop shortcuts on a new install, under the app id', async () => {
    await launch()
    expect(written()).toEqual([
      ['My App.lnk', 'create', 'com.example.my-app'],
      ['My App.lnk', 'create', 'com.example.my-app'],
    ])
    expect(mocks.app.setAppUserModelId).toHaveBeenCalledWith('com.example.my-app')
  })

  it('keeps a deleted shortcut deleted until the next install, and re-points the rest', async () => {
    await launch()
    fs.rmSync(join(mocks.dirs.desktop, 'My App.lnk'))
    vi.clearAllMocks()
    await launch()
    expect(written()).toEqual([['My App.lnk', 'replace', 'com.example.my-app']])
    expect(fs.existsSync(join(mocks.dirs.desktop, 'My App.lnk'))).toBe(false)
  })

  it('recreates deleted shortcuts on the next install', async () => {
    await launch()
    fs.rmSync(join(mocks.dirs.desktop, 'My App.lnk'))
    fs.writeFileSync(join(mocks.dirs.userData, 'electron-npm-installer.json'), JSON.stringify({ 'My App': 1 })) // an older install's birth time
    vi.clearAllMocks()
    await launch()
    expect(written().map(([, mode]) => mode).sort()).toEqual(['create', 'replace'])
  })

  it('gives a repo checkout its own shortcuts, so both stay launchable', async () => {
    installAt('src')
    await launch()
    expect(written()).toEqual([
      ['My App (local).lnk', 'create', 'com.example.my-app.local'],
      ['My App (local).lnk', 'create', 'com.example.my-app.local'],
    ])
  })

  it.each([
    ['an npx run', () => installAt('.npm', '_npx', 'ab12', 'node_modules'), {}, 'com.example.my-app'],
    ['dev', () => installAt('src'), { dev: true }, 'com.example.my-app.local'],
  ])('writes none for %s, but still sets the app id', async (_, setup, options, appId) => {
    setup()
    await launch({ appId: 'com.example.my-app', name: 'My App', ...options })
    expect(written()).toEqual([])
    expect(mocks.app.setAppUserModelId).toHaveBeenCalledWith(appId)
  })

  it('defaults the app id to the package name and the shortcut name to the app name', async () => {
    await launch({})
    expect(written()[0]).toEqual(['my-app.lnk', 'create', 'com.electron.my-app'])
  })
})
