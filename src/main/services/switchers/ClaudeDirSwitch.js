// Switch the Claude data directory this app reads from (claudeDir in ~/.claude-discover/config.json).
// Backs the StatusBar's "Change directory" button and the File menu's source-switcher;
// sole owner of that config. Picking a new directory restarts the app.
import { BrowserWindow, dialog } from 'electron'
import { CLAUDE_DIR, RECENT_CLAUDE_DIRS } from '../../paths.js'
import { config } from '../../config/ConfigFile.js'

export class ClaudeDirSwitch {
  constructor({ restart }) {
    this.restart = restart
  }

  status() {
    return { dir: CLAUDE_DIR }
  }

  // Switch to `claudeDir`, or browse for one when none is given; the app restarts on it
  async activate(claudeDir) {
    claudeDir ??= await browseForClaudeDir()
    if (!claudeDir || claudeDir === CLAUDE_DIR) return
    config.save({ claudeDir, recents: [...new Set([...RECENT_CLAUDE_DIRS, claudeDir])] })
    this.restart()
  }

  deactivate() { // unreachable from the UI — the button always activates
    throw new Error('Nothing to deactivate')
  }
}

async function browseForClaudeDir() {
  const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
    title: 'Select Claude directory',
    defaultPath: CLAUDE_DIR,
    properties: ['openDirectory'],
  })
  return r.canceled ? null : r.filePaths[0]
}
