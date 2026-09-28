// AutoUpdate reports a newer npm release, only for an `npm i -g` install (and dev, for debugging). These
// tests pin who asks the registry, when a version counts as newer, and that a failed check stays silent.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '1.10.1' } }))
// a getter, so each test's mode is read at call time, after the hoisted mock factory has run
const paths = { mode: 'npm-global' }
vi.mock('../src/main/paths.js', () => ({
  LAUNCH_MODES: { NPM_GLOBAL: 'npm-global', NPM_DEV: 'npm-dev' },
  get LAUNCH_MODE() { return paths.mode },
}))
vi.mock('latest-version', () => ({ default: vi.fn() }))

import latestVersion from 'latest-version'
import { AutoUpdate } from '../src/main/services/AutoUpdate.js'

function publish(version, { ok = true } = {}) {
  latestVersion.mockReset()
  if (ok) latestVersion.mockResolvedValue(version)
  else latestVersion.mockRejectedValue(new Error('Request failed with status code 503'))
  return latestVersion
}

beforeEach(() => {
  paths.mode = 'npm-global'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('AutoUpdate', () => {
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
