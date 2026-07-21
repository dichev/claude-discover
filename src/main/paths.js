import fs from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import { sync as writeFileAtomic } from 'write-file-atomic'

export const PROJECT_DIR = join(homedir(), '.claude-discover')
export const CONFIG_FILE = join(PROJECT_DIR, 'config.json')

export const getConfig = () => {
  return fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {}
}
export const setConfig = data => {
  fs.mkdirSync(PROJECT_DIR, { recursive: true })
  writeFileAtomic(CONFIG_FILE, JSON.stringify({ ...getConfig(), ...data }, null, 2))
}

const local = getConfig()
export const CLAUDE_DIR           = local.claudeDir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
export const RECENT_CLAUDE_DIRS   = local.recents || [CLAUDE_DIR]
export const CLAUDE_PROJECTS_DIR  = join(CLAUDE_DIR, 'projects')
export const CLAUDE_SETTINGS      = join(CLAUDE_DIR, 'settings.json')
export const STATUSLINE_PATH      = join(import.meta.dirname, '../../bin/claude/statusline.mjs')
export const PROXY_PATH           = join(import.meta.dirname, '../../bin/proxy.mjs')
export const CLAUDE_HOOKS_PATH    = join(import.meta.dirname, '../../bin/claude/hooks.mjs') // hook dispatcher, installed by ProxySwitch

