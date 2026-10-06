import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Maps a session's cwd to its git repo root, so sessions started in a repo's subfolders group
// under the repo instead of becoming projects of their own. Memoized per dir for the app's lifetime.
export class RepoRoots {
  #cache = new Map()

  // The nearest ancestor (or dir itself) holding a .git — a dir, or a file in worktrees/submodules — else null
  resolve(dir) {
    if (!dir || !path.isAbsolute(dir)) return Promise.resolve(null)
    if (!this.#cache.has(dir)) this.#cache.set(dir, this.#find(dir))
    return this.#cache.get(dir)
  }

  async #find(dir) {
    const home = os.homedir()
    for (let d = dir; ; d = path.dirname(d)) {
      if (d === home) return null // a dotfiles repo in ~ would swallow every project under it
      if (await fs.stat(path.join(d, '.git')).catch(() => null)) return d
      if (path.dirname(d) === d) return null
    }
  }
}
