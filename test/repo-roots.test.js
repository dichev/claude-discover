// RepoRoots maps a session cwd to the nearest git repo root above it, so a repo's
// subfolders group under the repo instead of becoming projects of their own.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { RepoRoots } from '../src/main/sessions/RepoRoots.js'

let tmp
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-roots-'))
  fs.mkdirSync(path.join(tmp, 'repo', '.git'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'repo', 'roles', 'owner'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'repo', 'nested', 'sub'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'repo', 'nested', '.git'), 'gitdir: ../.git/modules/nested') // submodule
  fs.mkdirSync(path.join(tmp, 'plain', 'sub'), { recursive: true })
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('RepoRoots', () => {
  it('resolves a subfolder to its repo root, and the root to itself', async () => {
    const roots = new RepoRoots()
    expect(await roots.resolve(path.join(tmp, 'repo', 'roles', 'owner'))).toBe(path.join(tmp, 'repo'))
    expect(await roots.resolve(path.join(tmp, 'repo'))).toBe(path.join(tmp, 'repo'))
  })

  it('stops at the nearest .git, including a .git file', async () => {
    expect(await new RepoRoots().resolve(path.join(tmp, 'repo', 'nested', 'sub'))).toBe(path.join(tmp, 'repo', 'nested'))
  })

  it('returns null outside any repo, for missing dirs and relative paths', async () => {
    const roots = new RepoRoots()
    expect(await roots.resolve(path.join(tmp, 'plain', 'sub'))).toBe(null)
    expect(await roots.resolve(path.join(tmp, 'gone', 'away'))).toBe(null)
    expect(await roots.resolve('relative/dir')).toBe(null)
    expect(await roots.resolve(null)).toBe(null)
  })
})
