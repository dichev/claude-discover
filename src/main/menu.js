import { app, BrowserWindow, Menu, dialog } from 'electron'
import { CLAUDE_DIR, RECENT_CLAUDE_DIRS, setConfig } from './paths.js'

const IS_DEV = !!process.env.ELECTRON_RENDERER_URL



export function buildAppMenu() {
  return Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []), // @macOS
    {
      label: 'File',
      submenu: [
        { label: 'Change directory…', click: (_i, win) => browse(win) },
        { type: 'separator' },
        ...RECENT_CLAUDE_DIRS.map(p => ({
          label: p, type: 'checkbox', checked: p === CLAUDE_DIR, click: () => switchTo(p),
        })),
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
  ])
}


function switchTo(claudeDir) {
  if (!claudeDir || claudeDir === CLAUDE_DIR) return
  setConfig({ claudeDir, recents: [...new Set([...RECENT_CLAUDE_DIRS, claudeDir])] })

  if (IS_DEV) { // electron-vite dev tears down its Vite server when Electron exits, so app.relaunch() leaves the respawned window with no renderer to load.
    dialog.showMessageBoxSync({ type: 'info',  message: 'Restart required',  detail: 'Stop and re-run `npm run dev` to apply the new directory.'})
    app.quit()
  } else {
    app.relaunch()
    BrowserWindow.getAllWindows().forEach(w => w.close())
    app.exit(0)
  }
}

async function browse(win) {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select Claude directory',
    defaultPath: CLAUDE_DIR,
    properties: ['openDirectory'],
  })
  if (!r.canceled) {
    switchTo(r.filePaths[0])
  }
}
