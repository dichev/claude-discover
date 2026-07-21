// Switch the Claude data directory this app reads from (claudeDir in ~/.claude-discover/config.json).
// Backs the StatusBar's "Change directory" button and the File menu's source-switcher;
// sole owner of that config. Picking a new directory relaunches the app.
import { app, BrowserWindow, dialog } from 'electron'
import { CLAUDE_DIR, RECENT_CLAUDE_DIRS } from '../../paths.js'
import { config } from '../Config.js'

const IS_DEV = !!process.env.ELECTRON_RENDERER_URL

export class ClaudeDirSwitch {

  status() {
    return { dir: CLAUDE_DIR }
  }

  // "Change directory" — browse for a new dir; selecting one restarts the app on it.
  activate() {
    return browseForClaudeDir(BrowserWindow.getFocusedWindow())
  }

  deactivate() { // unreachable from the UI — the button always activates
    throw new Error('Nothing to deactivate')
  }
}

export async function browseForClaudeDir(win) {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select Claude directory',
    defaultPath: CLAUDE_DIR,
    properties: ['openDirectory'],
  })
  if (!r.canceled) {
    switchToClaudeDir(r.filePaths[0])
  }
}

export function switchToClaudeDir(claudeDir) {
  if (!claudeDir || claudeDir === CLAUDE_DIR) return
  config.save({ claudeDir, recents: [...new Set([...RECENT_CLAUDE_DIRS, claudeDir])] })

  if (IS_DEV) { // electron-vite dev tears down its Vite server when Electron exits, so app.relaunch() leaves the respawned window with no renderer to load.
    dialog.showMessageBoxSync({ type: 'info',  message: 'Restart required',  detail: 'Stop and re-run `npm run dev` to apply the new directory.'})
    app.quit()
  } else {
    app.relaunch()
    BrowserWindow.getAllWindows().forEach(w => w.close())
    app.exit(0)
  }
}
