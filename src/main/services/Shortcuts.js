// @windows Start Menu + Desktop shortcuts for a `npm install -g` install. Written from the app rather than
// a postinstall: npm runs no uninstall hooks anyway, and plain node has no shortcut API.
//   del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Claude Discover*.lnk" "%USERPROFILE%\Desktop\Claude Discover*.lnk"   # remove

import fs from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { config } from '../config/ConfigFile.js'
import { LAUNCH_MODE, LAUNCH_MODES } from '../paths.js'


const APP_ID = 'claude-discover' // shared by the process and the shortcuts, so a pinned taskbar icon groups with the window

export class Shortcuts {
  // Call before any window is created, so the window picks up the app id.
  activate() {
    if (process.platform !== 'win32') return
    app.setAppUserModelId(APP_ID)
    if (LAUNCH_MODE === LAUNCH_MODES.NPX_TEMP || LAUNCH_MODE === LAUNCH_MODES.NPM_DEV) return // an npx cache dir is deleted later, and dev shouldn't touch the user's shortcuts

    // An installed package and a repo checkout get their own shortcuts, so both stay launchable
    const name = LAUNCH_MODE === LAUNCH_MODES.NPM_GLOBAL ? 'Claude Discover' : 'Claude Discover (local)'

    // Existing shortcuts are re-pointed on every launch (the last launched install wins, as in DeepLink);
    // missing ones are created once per install, so a deleted shortcut stays deleted until the next `npm i -g`.
    // npm recreates the package dir on every (re)install, so its birth time identifies the install.
    const created    = config.read().shortcuts ?? {}
    const install    = fs.statSync(app.getAppPath()).birthtimeMs
    const newInstall = created[name] !== install
    for (const dir of [join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs'), app.getPath('desktop')]) {
      const path = join(dir, `${name}.lnk`)
      const exists = fs.existsSync(path)
      if (!exists && !newInstall) continue
      const written = shell.writeShortcutLink(path, exists ? 'replace' : 'create', {
        target:         process.execPath,
        args:           `"${app.getAppPath()}"`,
        description:    'Browse your local Claude Code sessions',
        icon:           process.execPath,
        iconIndex:      0,
        appUserModelId: APP_ID,
      })
      if (!written) throw new Error(`cannot write ${path}`) // before the save below, so the next launch retries
    }
    if (newInstall) config.save({ shortcuts: { ...created, [name]: install } })
  }
}
