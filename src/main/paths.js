import {homedir} from 'node:os'
import {join} from 'node:path'
import {config} from './services/Config.js'

const local = config.read()
export const CLAUDE_DIR           = local.claudeDir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
export const RECENT_CLAUDE_DIRS   = local.recents || [CLAUDE_DIR]
export const CLAUDE_PROJECTS_DIR  = join(CLAUDE_DIR, 'projects')
export const CLAUDE_SETTINGS      = join(CLAUDE_DIR, 'settings.json')
export const CACHE_DIR            = join(import.meta.dirname, '../../cache') // pricing tables live in the checkout, not cwd
export const STATUSLINE_PATH      = join(import.meta.dirname, '../../bin/claude/statusline.mjs')
export const PROXY_PATH           = join(import.meta.dirname, '../../bin/proxy.mjs')
export const CLAUDE_HOOKS_PATH    = join(import.meta.dirname, '../../bin/claude/hooks.mjs') // hook dispatcher, installed by ProxySwitch

