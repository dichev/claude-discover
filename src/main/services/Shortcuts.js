// Launcher shortcuts for a `npm install -g` install: @windows Start Menu + Desktop .lnk files, @macOS an ~/Applications bundle.
// Written from the app rather than a postinstall: npm runs no uninstall hooks anyway, and plain node has no shortcut API.
//   del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Claude Discover*.lnk" "%USERPROFILE%\Desktop\Claude Discover*.lnk"   # remove
//   rm -rf ~/Applications/"Claude Discover"*.app                                                                                # remove

import fs from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { config } from '../config/ConfigFile.js'
import { LAUNCH_MODE, LAUNCH_MODES } from '../paths.js'


const APP_ID = 'claude-discover' // shared by the process and the shortcuts, so a pinned taskbar icon groups with the window
const GLOBAL = LAUNCH_MODE === LAUNCH_MODES.NPM_GLOBAL
const NAME   = GLOBAL ? 'Claude Discover' : 'Claude Discover (local)' // an installed package and a repo checkout get their own shortcuts, so both stay launchable

export class Shortcuts {
  #os = process.platform === 'win32' ? new WindowsLinks() : process.platform === 'darwin' ? new MacBundle() : null

  // Call before any window is created, so the window picks up the app id.
  activate() {
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
    if (!this.#os || LAUNCH_MODE === LAUNCH_MODES.NPX_TEMP || LAUNCH_MODE === LAUNCH_MODES.NPM_DEV) return // an npx cache dir is deleted later, and dev shouldn't touch the user's shortcuts

    // Existing shortcuts are re-pointed on every launch (the last launched install wins, as in DeepLink);
    // missing ones are created once per install, so a deleted shortcut stays deleted until the next `npm i -g`.
    // npm recreates the package dir on every (re)install, so its birth time identifies the install.
    const created    = config.read().shortcuts ?? {}
    const install    = fs.statSync(app.getAppPath()).birthtimeMs
    const newInstall = created[NAME] !== install
    for (const path of this.#os.paths()) {
      const exists = fs.existsSync(path)
      if (!exists && !newInstall) continue
      this.#os.write(path, exists) // throws before the save below, so the next launch retries
    }
    if (newInstall) config.save({ shortcuts: { ...created, [NAME]: install } })
  }
}


class WindowsLinks { // @windows
  paths() {
    return [join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs'), app.getPath('desktop')].map(dir => join(dir, `${NAME}.lnk`))
  }

  write(path, exists) {
    const written = shell.writeShortcutLink(path, exists ? 'replace' : 'create', {
      target:         process.execPath,
      args:           `"${app.getAppPath()}"`,
      description:    'Browse your local Claude Code sessions',
      icon:           process.execPath,
      iconIndex:      0,
      appUserModelId: APP_ID,
    })
    if (!written) throw new Error(`cannot write ${path}`)
  }
}


// A stub bundle handing off to npm's Electron.app, not a renamed copy of it: editing Electron's plist breaks its signature.
// Finder launches get a bare PATH, so the stub passes on this launch's (claude for AI Analyze, npm/node for AutoUpdate).
class MacBundle { // @macOS
  paths() { return [join(app.getPath('home'), 'Applications', `${NAME}.app`)] }

  write(path) {
    const electronApp = join(process.execPath, '../../..')
    const quote = s => `'${s.replaceAll("'", `'\\''`)}'`
    fs.mkdirSync(join(path, 'Contents/MacOS'), { recursive: true })
    fs.mkdirSync(join(path, 'Contents/Resources'), { recursive: true })
    fs.copyFileSync(join(electronApp, 'Contents/Resources/electron.icns'), join(path, 'Contents/Resources/icon.icns'))
    fs.writeFileSync(join(path, 'Contents/MacOS/launch'), [
      '#!/bin/sh',
      `exec open -n ${quote(electronApp)} --env ${quote(`PATH=${process.env.PATH}`)} --args ${quote(app.getAppPath())}`,
      '',
    ].join('\n'), { mode: 0o755 })
    // LSUIElement keeps the stub itself out of the Dock, next to Electron's icon
    fs.writeFileSync(join(path, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${NAME}</string>
  <key>CFBundleIdentifier</key><string>com.dichev.${APP_ID}${GLOBAL ? '' : '.local'}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`)
  }
}
