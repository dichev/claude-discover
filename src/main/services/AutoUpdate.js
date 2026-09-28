// Tells an `npm i -g` install that a newer version is published, and installs it. npx and `npm start` aren't
// updated through `npm i -g`, so they never hit the registry; dev does, so the flow can be debugged there
// (it updates the global install, not the dev checkout).
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { app, dialog } from 'electron'
import latestVersion from 'latest-version'
import semver from 'semver'
import { LAUNCH_MODE, LAUNCH_MODES, UPDATE_PATH } from '../paths.js'

export class AutoUpdate {
  #result = null

  // Once per launch — a renderer reload reuses the answer
  check() {
    return this.#result ??= this.#fetchNewer().catch(err => {
      console.warn('[auto-update] failed:', err.message)
      return null
    })
  }

  async install() {
    const update = await this.check()
    if (!update) return
    // Dev isn't reopened: its renderer lives on the Vite dev server, which dies with the app
    const reopen = LAUNCH_MODE === LAUNCH_MODES.NPM_DEV ? [] : [process.execPath, app.getAppPath()]
    const args = [UPDATE_PATH, process.pid, update.latest, ...reopen].map(String)
    // The system node from home, not our electron.exe: npm can't replace the package while anything runs inside it.
    // @windows `start` gives it a console window of its own, so the update's progress stays visible while the app is closed
    const [command, commandArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', 'Updating Claude Discover', 'node', ...args]] : ['node', args]
    spawn(command, commandArgs, { detached: true, stdio: ['ignore', 'inherit', 'inherit'], cwd: homedir() })
      .once('spawn', () => app.quit())
      .once('error', err => dialog.showErrorBox('Update failed', `Could not start node: ${err.message}`))
  }

  async #fetchNewer() {
    if (LAUNCH_MODE !== LAUNCH_MODES.NPM_GLOBAL && LAUNCH_MODE !== LAUNCH_MODES.NPM_DEV) return null
    const latest = await latestVersion('claude-discover')
    const current = app.getVersion()
    return semver.gt(latest, current) ? { current, latest } : null
  }
}
