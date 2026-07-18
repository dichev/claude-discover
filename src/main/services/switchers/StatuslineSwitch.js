// Install/uninstall this app's status line (bin/claude/statusline.mjs) as Claude Code's
// statusLine command in settings.json. Backs the StatusBar's Activate/Deactivate button;
// sole owner of that config.
import { basename } from 'node:path'
import { ClaudeSettings } from '../ClaudeSettings.js'
import { STATUSLINE_PATH } from '../../paths.js'

const STATUS_FILE = basename(STATUSLINE_PATH)
const STATUS_CMD = `node "${STATUSLINE_PATH}"`

export class StatuslineSwitch {

  status() {
    return { installed: new ClaudeSettings().statusLine?.command?.includes(STATUS_FILE) ?? false }
  }

  // Install our status line, repairing a stale absolute path in place (matched by basename).
  // A different already-configured status line is never overwritten — that throws instead.
  activate() {
    const settings = new ClaudeSettings() // fresh — settings.json may have changed since app launch
    const command = settings.statusLine?.command
    if (command && !command.includes(STATUS_FILE))
      throw new Error(`Leaving your existing status line in place (${command}) — remove it from settings.json to use ours.`)
    if (command !== STATUS_CMD) {
      settings.statusLine = { type: 'command', command: STATUS_CMD }
      settings.save()
    }
  }

  // Remove the statusLine entry — only when it's ours, so a foreign status line is never touched.
  deactivate() {
    const settings = new ClaudeSettings()
    if (settings.statusLine?.command?.includes(STATUS_FILE)) {
      settings.statusLine = undefined
      settings.save()
    }
  }
}
