// AutoUpdate reports a newer npm release, only for an `npm i -g` install (and dev, for debugging), and
// installs it through bin/update.mjs. These tests pin who asks the registry, when a version counts as
// newer, that a failed check stays silent, and when the install hands off to the helper and quits.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.10.1', getAppPath: () => '/npm/node_modules/claude-discover', quit: vi.fn() },
  dialog: { showErrorBox: vi.fn() },
}))
// a getter, so each test's mode is read at call time, after the hoisted mock factory has run
const paths = { mode: 'npm-global' }
vi.mock('../src/main/paths.js', () => ({
  UPDATE_PATH: '/npm/node_modules/claude-discover/bin/update.mjs',
  LAUNCH_MODES: { NPM_GLOBAL: 'npm-global', NPM_DEV: 'npm-dev' },
  get LAUNCH_MODE() { return paths.mode },
}))
vi.mock('latest-version', () => ({ default: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { app, dialog } from 'electron'
import latestVersion from 'latest-version'
import { AutoUpdate } from '../src/main/services/AutoUpdate.js'

function publish(version, { ok = true } = {}) {
  if (ok) latestVersion.mockResolvedValue(version)
  else latestVersion.mockRejectedValue(new Error('Request failed with status code 503'))
  return latestVersion
}

let helper // the spawned helper process; each test decides whether it emits 'spawn' or 'error'

beforeEach(() => {
  vi.clearAllMocks()
  paths.mode = 'npm-global'
  spawn.mockImplementation(() => helper = new EventEmitter())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('check', () => {
  it.each(['npm-global', 'npm-dev'])('reports a newer published version to a %s launch', async mode => {
    paths.mode = mode
    publish('1.11.0')
    expect(await new AutoUpdate().check()).toEqual({ current: '1.10.1', latest: '1.11.0' })
  })

  it.each(['1.10.1', '1.9.5'])('stays quiet when the registry has %s', async version => {
    publish(version)
    expect(await new AutoUpdate().check()).toBeNull()
  })

  it.each(['npm-start', 'npx-temp'])('never asks the registry for a %s launch', async mode => {
    paths.mode = mode
    const registry = publish('9.9.9')
    expect(await new AutoUpdate().check()).toBeNull()
    expect(registry).not.toHaveBeenCalled()
  })

  it('stays quiet when the registry fails', async () => {
    publish('9.9.9', { ok: false })
    expect(await new AutoUpdate().check()).toBeNull()
  })

  it('asks the registry once per launch', async () => {
    const registry = publish('1.11.0')
    const autoUpdate = new AutoUpdate()
    await autoUpdate.check()
    await autoUpdate.check()
    expect(registry).toHaveBeenCalledTimes(1)
  })
})

describe('install', () => {
  it('hands off to the helper with everything it needs, then quits once it runs', async () => {
    publish('1.11.0')
    await new AutoUpdate().install()
    const [command, args, options] = spawn.mock.calls[0]
    expect([command, ...args].slice(-6)).toEqual([ // @windows behind `cmd /c start <title>`
      'node',
      '/npm/node_modules/claude-discover/bin/update.mjs',
      String(process.pid),
      '1.11.0',
      process.execPath,
      '/npm/node_modules/claude-discover',
    ])
    expect(options).toMatchObject({ detached: true })
    expect(app.quit).not.toHaveBeenCalled()
    helper.emit('spawn')
    expect(app.quit).toHaveBeenCalled()
  })

  it('stays open and says why when node cannot be started', async () => {
    publish('1.11.0')
    await new AutoUpdate().install()
    helper.emit('error', new Error('spawn node ENOENT'))
    expect(app.quit).not.toHaveBeenCalled()
    expect(dialog.showErrorBox).toHaveBeenCalled()
  })

  it('runs the update from dev too, without asking to reopen a window whose dev server is gone', async () => {
    paths.mode = 'npm-dev'
    publish('1.11.0')
    await new AutoUpdate().install()
    const [command, args] = spawn.mock.calls[0]
    expect([command, ...args].slice(-4)).toEqual(['node', '/npm/node_modules/claude-discover/bin/update.mjs', String(process.pid), '1.11.0'])
  })

  it('does nothing without a newer version', async () => {
    publish('1.10.1')
    await new AutoUpdate().install()
    expect(spawn).not.toHaveBeenCalled()
  })
})
