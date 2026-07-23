import {homedir} from 'node:os'
import {join} from 'node:path'
import {config} from './config/ConfigFile.js'

const local = config.read()
export const DATA_DIR             = config.dataDir
export const CLAUDE_DIR           = local.claudeDir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
export const RECENT_CLAUDE_DIRS   = local.recents || [CLAUDE_DIR]
export const CLAUDE_PROJECTS_DIR  = join(CLAUDE_DIR, 'projects')
export const CLAUDE_SETTINGS      = join(CLAUDE_DIR, 'settings.json')
export const IS_EPHEMERAL         = import.meta.dirname.split(/[\\/]/).includes('_npx') //  npx runs the package out of a cache dir (~/.npm/_npx/<hash>)
// bin paths assume this file sits two levels below the repo root (true for both src/main and out/main bundle)
export const STATUSLINE_PATH      = join(import.meta.dirname, '../../bin/claude/statusline.mjs')
export const PROXY_PATH           = join(import.meta.dirname, '../../bin/proxy.mjs')
export const CLAUDE_HOOKS_PATH    = join(import.meta.dirname, '../../bin/claude/hooks.mjs') // hook dispatcher, installed by ProxySwitch
