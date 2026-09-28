// Tells an `npm i -g` install that a newer version is published. npx and `npm start` aren't updated
// through `npm i -g`, so they never hit the registry; dev does, so the hint can be debugged there.
import { app } from 'electron'
import latestVersion from 'latest-version'
import semver from 'semver'
import { LAUNCH_MODE, LAUNCH_MODES } from '../paths.js'

export class AutoUpdate {
  #result = null

  // Once per launch — a renderer reload reuses the answer
  check() {
    return this.#result ??= this.#fetchNewer().catch(err => {
      console.warn('[auto-update] failed:', err.message)
      return null
    })
  }

  async #fetchNewer() {
    if (LAUNCH_MODE !== LAUNCH_MODES.NPM_GLOBAL && LAUNCH_MODE !== LAUNCH_MODES.NPM_DEV) return null
    const latest = await latestVersion('claude-discover')
    const current = app.getVersion()
    return semver.gt(latest, current) ? { current, latest } : null
  }
}
