import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const WORKTREE  = /\/\.claude\/worktrees\/([^/]+)/
const TEMP_ROOT = /^(.*?\/AppData\/Local\/Temp|\/(?:private\/)?(?:tmp|var\/folders\/[^/]+\/[^/]+\/T))\/(.+)/i
const WINDOWS   = process.platform === 'win32'
// @windows Only drive paths: a UNC share can stall every stat for its network timeout, and a WSL
// Claude dir's POSIX cwds would be looked up on the current drive
const LOCAL_DIR = WINDOWS ? /^[a-z]:[\\/]/i : /^\//

// Maps a session's cwd to the project it groups under, so worktrees, temp dirs and a repo's
// subfolders don't each become a project of their own. Repo roots are memoized per dir for the app's lifetime.
export class ProjectResolver {
  #repoRoots = new Map()

  // `subdir` is where in the project the session ran: a repo or worktree subfolder, or a temp run dir
  async resolve(cwd) {
    const out = { project: cwd, subdir: null, worktree: null, worktreePath: null, tempPath: null }
    const wt = cwd?.replace(/\\/g, '/').match(WORKTREE)
    if (wt) {
      out.worktree = wt[1]
      out.worktreePath = cwd.slice(0, wt.index + wt[0].length)
      out.subdir = cwd.slice(out.worktreePath.length + 1).replace(/\\/g, '/') || null
      out.project = cwd.slice(0, wt.index)
    }
    // Temp dirs are fresh per run, so they all fold into the temp root (repos made in them included)
    const tmp = out.project?.replace(/\\/g, '/').match(TEMP_ROOT)
    if (tmp) {
      out.tempPath = out.project
      out.subdir = tmp[2]
      out.project = out.project.slice(0, tmp[1].length)
      return out
    }
    const root = await this.repoRoot(out.project)
    if (root && root !== out.project) {
      out.subdir = [path.relative(root, out.project).replaceAll('\\', '/'), out.subdir].filter(Boolean).join('/')
      out.project = root
    }
    return out
  }

  // The nearest ancestor (or dir itself) holding a .git — a dir, or a file in worktrees/submodules — else null
  repoRoot(dir) {
    if (!LOCAL_DIR.test(dir ?? '')) return Promise.resolve(null)
    if (!this.#repoRoots.has(dir)) this.#repoRoots.set(dir, this.#findRepoRoot(dir))
    return this.#repoRoots.get(dir)
  }

  async #findRepoRoot(dir) {
    const home = os.homedir()
    const isHome = WINDOWS ? d => d.toLowerCase() === home.toLowerCase() : d => d === home // @windows cwds can differ in drive-letter case
    for (let d = dir; ; d = path.dirname(d)) {
      if (isHome(d)) return null // a dotfiles repo in ~ would swallow every project under it
      if (await fs.stat(path.join(d, '.git')).catch(() => null)) return d
      if (path.dirname(d) === d) return null
    }
  }
}
