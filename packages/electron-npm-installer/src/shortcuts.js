// Launcher shortcuts for an `npm i -g` install: @windows Start Menu + Desktop .lnk files, @macOS an ~/Applications bundle.
// Written from the app rather than a postinstall: npm runs no uninstall hooks anyway, and plain node has no shortcut API.
import fs from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { appPackage } from './app.js'
import { LAUNCH_MODES, launchMode } from './launch-mode.js'

// Call before any window is created, so the window picks up the app id
export function createShortcuts({ appId = `com.electron.${appPackage().name}`, name = app.getName(), description = '', dev = false } = {}) {
  const mode = launchMode(app.getAppPath(), { dev })
  // An installed package and a repo checkout get their own shortcuts, so both stay launchable
  const shortcut = mode === LAUNCH_MODES.NPM_START || mode === LAUNCH_MODES.NPM_DEV ? { id: `${appId}.local`, name: `${name} (local)`, description } : { id: appId, name, description }
  if (process.platform === 'win32') app.setAppUserModelId(shortcut.id) // shared by the process and its shortcuts, so a pinned taskbar icon groups with the window
  if (mode === LAUNCH_MODES.NPX_TEMP || mode === LAUNCH_MODES.NPM_DEV) return // an npx cache dir is deleted later, and dev shouldn't touch the user's shortcuts

  const os = process.platform === 'win32' ? new WindowsLinks(shortcut) : process.platform === 'darwin' ? new MacBundle(shortcut) : null
  if (!os) return

  // Existing shortcuts are re-pointed on every launch (the last launched install wins);
  // missing ones are created once per install, so a deleted shortcut stays deleted until the next `npm i -g`.
  // npm recreates the package dir on every (re)install, so its birth time identifies the install.
  const stateFile  = join(app.getPath('userData'), 'electron-npm-installer.json')
  const created    = readJson(stateFile)
  const install    = fs.statSync(app.getAppPath()).birthtimeMs
  const newInstall = created[shortcut.name] !== install
  for (const path of os.paths()) {
    const exists = fs.existsSync(path)
    if (!exists && !newInstall) continue
    os.write(path, exists) // throws before the save below, so the next launch retries
  }
  if (newInstall) {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(stateFile, JSON.stringify({ ...created, [shortcut.name]: install }))
  }
}

function readJson(path) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')) } catch { return {} }
}


class WindowsLinks { // @windows
  constructor(shortcut) { this.shortcut = shortcut }

  paths() {
    return [join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs'), app.getPath('desktop')].map(dir => join(dir, `${this.shortcut.name}.lnk`))
  }

  write(path, exists) {
    const written = shell.writeShortcutLink(path, exists ? 'replace' : 'create', {
      target:         process.execPath,
      args:           `"${app.getAppPath()}"`,
      description:    this.shortcut.description,
      icon:           process.execPath,
      iconIndex:      0,
      appUserModelId: this.shortcut.id,
    })
    if (!written) throw new Error(`cannot write ${path}`)
  }
}


// A stub bundle handing off to npm's Electron.app, not a renamed copy of it: editing Electron's plist breaks its signature.
// Finder launches get a bare PATH, so the stub passes on this launch's (the update needs npm and node, the app maybe more).
class MacBundle { // @macOS
  constructor(shortcut) { this.shortcut = shortcut }

  paths() { return [join(app.getPath('home'), 'Applications', `${this.shortcut.name}.app`)] }

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
  <key>CFBundleName</key><string>${this.shortcut.name}</string>
  <key>CFBundleIdentifier</key><string>${this.shortcut.id}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`)
  }
}
