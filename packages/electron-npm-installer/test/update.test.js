// checkForUpdate reports a newer npm release, only for an `npm i -g` install (and dev, for debugging), and
// installUpdate installs it through installer.js. These tests pin who asks the registry, when a version counts as
// newer, that a failed check stays silent, and when the install hands off to the installer and quits.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted, so every fresh import of update.js (one per launch) gets these same mocks
const mocks = vi.hoisted(() => ({
  appPath: null, // set per launch
  app: { getVersion: () => '1.10.1', getName: () => 'my-app', getAppPath: () => mocks.appPath, quit: vi.fn() },
  dialog: { showErrorBox: vi.fn() },
  spawn: vi.fn(),
  latestVersion: vi.fn(),
}))
vi.mock('electron', () => ({ app: mocks.app, dialog: mocks.dialog }))
vi.mock('node:fs', () => ({ readFileSync: () => JSON.stringify({ name: 'my-app', bin: { 'my-app': 'bin/my-app.mjs' } }) }))
vi.mock('latest-version', () => ({ default: mocks.latestVersion }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

import { EventEmitter } from 'node:events'
import { join } from 'node:path'

const INSTALLER_PATH = join(import.meta.dirname, '../src/installer.js')
const DIRS = { 'npm-global': '/npm/node_modules/my-app', 'npx-temp': '/home/u/.npm/_npx/ab12/node_modules/my-app', 'npm-start': '/src/my-app' }

// A fresh app launch: the once-per-launch check lives in update.js's module state
async function launch(mode) {
  mocks.appPath = DIRS[mode] ?? DIRS['npm-start']
  vi.resetModules()
  const { checkForUpdate, installUpdate } = await import('../src/update.js')
  return { check: () => checkForUpdate({ dev: mode === 'npm-dev' }), installUpdate }
}

async function launchAndInstall(mode) {
  const { check, installUpdate } = await launch(mode)
  await check()
  await installUpdate()
}

// The spawned command line, from `node` on (@windows it sits behind `cmd /c start <title>`)
function spawnedArgv() {
  const [command, args] = mocks.spawn.mock.calls[0]
  return [command, ...args]
}

function publish(version, { ok = true } = {}) {
  if (ok) mocks.latestVersion.mockResolvedValue(version)
  else mocks.latestVersion.mockRejectedValue(new Error('Request failed with status code 503'))
  return mocks.latestVersion
}

let installer // the spawned installer process; each test decides whether it emits 'spawn' or 'error'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.spawn.mockImplementation(() => installer = new EventEmitter())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('checkForUpdate', () => {
  it.each(['npm-global', 'npm-dev'])('reports a newer published version to a %s launch', async mode => {
    publish('1.11.0')
    const { check } = await launch(mode)
    expect(await check()).toEqual({ name: 'my-app', current: '1.10.1', latest: '1.11.0', mode })
  })

  it.each(['1.10.1', '1.9.5'])('stays quiet when the registry has %s', async version => {
    publish(version)
    const { check } = await launch('npm-global')
    expect(await check()).toBeNull()
  })

  it('asks the registry for the app\'s own package', async () => {
    const registry = publish('1.11.0')
    const { check } = await launch('npm-global')
    await check()
    expect(registry).toHaveBeenCalledWith('my-app')
  })

  it('never asks the registry from a local checkout', async () => {
    const registry = publish('9.9.9')
    const { check } = await launch('npm-start')
    expect(await check()).toBeNull()
    expect(registry).not.toHaveBeenCalled()
  })

  it('offers an npx run the global install, even on the latest version', async () => {
    publish('1.10.1')
    const { check } = await launch('npx-temp')
    expect(await check()).toEqual({ name: 'my-app', current: '1.10.1', latest: '1.10.1', mode: 'npx-temp' })
  })

  it('stays quiet when the registry fails', async () => {
    publish('9.9.9', { ok: false })
    const { check } = await launch('npm-global')
    expect(await check()).toBeNull()
  })

  it('asks the registry once per launch', async () => {
    const registry = publish('1.11.0')
    const { check } = await launch('npm-global')
    await check()
    await check()
    expect(registry).toHaveBeenCalledTimes(1)
  })
})

describe('installUpdate', () => {
  it('hands off to the installer with everything it needs, then quits once it runs', async () => {
    publish('1.11.0')
    await launchAndInstall('npm-global')
    expect(spawnedArgv().slice(-7)).toEqual([
      'node',
      INSTALLER_PATH,
      String(process.pid),
      'my-app',
      '1.11.0',
      '--reopen',
      'bin/my-app.mjs',
    ])
    expect(mocks.spawn.mock.calls[0][2]).toMatchObject({ detached: true })
    expect(mocks.app.quit).not.toHaveBeenCalled()
    installer.emit('spawn')
    expect(mocks.app.quit).toHaveBeenCalled()
  })

  it('stays open and says why when node cannot be started', async () => {
    publish('1.11.0')
    await launchAndInstall('npm-global')
    installer.emit('error', new Error('spawn node ENOENT'))
    expect(mocks.app.quit).not.toHaveBeenCalled()
    expect(mocks.dialog.showErrorBox).toHaveBeenCalled()
  })

  it('runs the update from dev too, without asking to reopen a window whose dev server is gone', async () => {
    publish('1.11.0')
    await launchAndInstall('npm-dev')
    expect(spawnedArgv().slice(-3)).toEqual([String(process.pid), 'my-app', '1.11.0'])
  })

  it('installs the global version from an npx run', async () => {
    publish('1.10.1')
    await launchAndInstall('npx-temp')
    expect(spawnedArgv().slice(-4)).toEqual(['my-app', '1.10.1', '--reopen', 'bin/my-app.mjs'])
  })

  it('does nothing before a check', async () => {
    publish('1.11.0')
    const { installUpdate } = await launch('npm-global')
    await installUpdate()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('does nothing without a newer version', async () => {
    publish('1.10.1')
    await launchAndInstall('npm-global')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
