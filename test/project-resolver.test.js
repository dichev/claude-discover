// ProjectResolver maps a session cwd to the project it groups under: worktrees to their repo,
// temp run dirs to the temp root, and a repo's subfolders to the repo root.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ProjectResolver } from '../src/main/sessions/ProjectResolver.js'

const WIN_TMP = 'C:\\Users\\dev\\AppData\\Local\\Temp'

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

describe('ProjectResolver.resolve', () => {
  it('groups temp dirs under the temp root, with the path below it as subdir', async () => {
    const projects = new ProjectResolver()
    expect(await projects.resolve(`${WIN_TMP}\\teamflows-exp-Dkl6FZ\\roles\\illustrator`)).toMatchObject({
      project: WIN_TMP, subdir: 'teamflows-exp-Dkl6FZ/roles/illustrator', tempPath: `${WIN_TMP}\\teamflows-exp-Dkl6FZ\\roles\\illustrator`,
    })
    expect(await projects.resolve('/tmp/run-a1b2c3/app')).toMatchObject({ project: '/tmp', subdir: 'run-a1b2c3/app' })
    expect((await projects.resolve('/private/var/folders/ab/xyz123/T/run/app')).project).toBe('/private/var/folders/ab/xyz123/T')
    expect((await projects.resolve('/var/folders/ab/xyz123/T/run')).project).toBe('/var/folders/ab/xyz123/T')
  })

  it('leaves dirs outside temp, and the temp root itself, alone', async () => {
    const projects = new ProjectResolver()
    for (const dir of ['/home/dev/tmp/app', '/tmp']) {
      expect(await projects.resolve(dir)).toMatchObject({ project: dir, subdir: null, tempPath: null })
    }
    expect((await projects.resolve(null)).project).toBe(null)
  })

  it('groups a worktree under its parent repo', async () => {
    expect(await new ProjectResolver().resolve('D:\\app\\.claude\\worktrees\\x')).toMatchObject({
      project: 'D:\\app', worktree: 'x', worktreePath: 'D:\\app\\.claude\\worktrees\\x', subdir: null,
    })
    expect(await new ProjectResolver().resolve('D:\\app\\.claude\\worktrees\\x\\packages\\web')).toMatchObject({
      project: 'D:\\app', worktree: 'x', subdir: 'packages/web',
    })
  })

  it('groups a repo subfolder under the repo root', async () => {
    const projects = new ProjectResolver()
    const repo = path.resolve('/repo')
    projects.repoRoot = async () => repo // the fixture repo sits in temp, which resolve folds first
    expect(await projects.resolve(path.join(repo, 'roles', 'owner'))).toMatchObject({ project: repo, subdir: 'roles/owner' })
    expect(await projects.resolve(repo)).toMatchObject({ project: repo, subdir: null })
  })
})

describe('ProjectResolver.repoRoot', () => {
  it('resolves a subfolder to its repo root, and the root to itself', async () => {
    const projects = new ProjectResolver()
    expect(await projects.repoRoot(path.join(tmp, 'repo', 'roles', 'owner'))).toBe(path.join(tmp, 'repo'))
    expect(await projects.repoRoot(path.join(tmp, 'repo'))).toBe(path.join(tmp, 'repo'))
  })

  it('stops at the nearest .git, including a .git file', async () => {
    expect(await new ProjectResolver().repoRoot(path.join(tmp, 'repo', 'nested', 'sub'))).toBe(path.join(tmp, 'repo', 'nested'))
  })

  it('returns null outside any repo, for missing dirs and relative paths', async () => {
    const projects = new ProjectResolver()
    expect(await projects.repoRoot(path.join(tmp, 'plain', 'sub'))).toBe(null)
    expect(await projects.repoRoot(path.join(tmp, 'gone', 'away'))).toBe(null)
    expect(await projects.repoRoot('relative/dir')).toBe(null)
    expect(await projects.repoRoot(null)).toBe(null)
  })

  it.runIf(process.platform === 'win32')('skips UNC shares and POSIX paths on Windows', async () => {
    const projects = new ProjectResolver()
    expect(await projects.repoRoot('\\\\server\\share\\proj')).toBe(null)
    expect(await projects.repoRoot('/home/u/repo')).toBe(null)
  })
})
