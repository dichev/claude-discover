import { Menu } from 'electron'
import { CLAUDE_DIR, RECENT_CLAUDE_DIRS } from './paths.js'
import { browseForClaudeDir, switchToClaudeDir } from './services/switchers/ClaudeDirSwitch.js'


export function buildAppMenu({ onFind, onEscape } = {}) {
  return Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []), // @macOS
    {
      label: 'File',
      submenu: [
        { label: 'Change directory…', click: (_i, win) => browseForClaudeDir(win) },
        { type: 'separator' },
        ...RECENT_CLAUDE_DIRS.map(p => ({
          label: p, type: 'checkbox', checked: p === CLAUDE_DIR, click: () => switchToClaudeDir(p),
        })),
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { // @macOS Cmd+C/V/A have no key equivalents without an Edit menu; Windows/Linux get these from Chromium
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => onFind?.() },
        { label: 'Deselect', accelerator: 'Escape', click: (_i, win) => onEscape?.(win) },
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
