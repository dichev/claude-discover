// Tells an `npm i -g` install of an Electron app about a newer npm release and installs it; an npx run is offered the
// global install instead. A checkout only checks with `dev`, to debug the flow (it updates the global install).
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import latestVersion from 'latest-version'
import semver from 'semver'
import { appPackage } from './app.js'
import { LAUNCH_MODES, launchMode } from './launch-mode.js'

const INSTALLER_PATH = join(import.meta.dirname, 'installer.js')

let checked = null

// Once per launch — a renderer reload reuses the answer
export function checkForUpdate({ dev = false } = {}) {
  return checked ??= fetchNewer(launchMode(app.getAppPath(), { dev })).catch(err => {
    console.warn('[electron-npm-installer] check failed:', err.message)
    return null
  })
}

// Installs what the check found, so the user gets the version they were shown
export async function installUpdate() {
  const update = await checked
  if (!update) return
  const { bin } = appPackage()
  // Dev isn't reopened: its renderer usually lives on a dev server, which dies with the app
  const reopen = update.mode !== LAUNCH_MODES.NPM_DEV && bin ? ['--reopen', bin] : []
  const args = [INSTALLER_PATH, process.pid, update.name, update.latest, ...reopen].map(String)
  // The system node, not our electron.exe: npm can't replace the package while anything runs inside it.
  // @windows `start` opens a console showing the progress; its title needs a space, or node leaves it unquoted and `start` runs it
  const [command, commandArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', `Updating ${app.getName()}`, 'node', ...args]] : ['node', args]
  spawn(command, commandArgs, { detached: true, stdio: ['ignore', 'inherit', 'inherit'], cwd: homedir() })
    .once('spawn', () => app.quit())
    .once('error', err => dialog.showErrorBox('Update failed', `Could not start node: ${err.message}`))
}

async function fetchNewer(mode) {
  if (mode === LAUNCH_MODES.NPM_START) return null
  const { name } = appPackage()
  const latest = await latestVersion(name)
  const current = app.getVersion()
  // npx isn't updated in place: it's always offered the global install instead
  return mode === LAUNCH_MODES.NPX_TEMP || semver.gt(latest, current) ? { name, current, latest, mode } : null
}
