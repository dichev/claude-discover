import {homedir} from 'node:os'
import {basename, dirname, join} from 'node:path'
import {config} from './config/ConfigFile.js'
import {launchMode} from 'electron-update-from-npm/launch-mode'

const local = config.read()
export const DATA_DIR             = config.dataDir
export const CLAUDE_DIR           = local.claudeDir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
export const RECENT_CLAUDE_DIRS   = local.recents || [CLAUDE_DIR]
export const CLAUDE_PROJECTS_DIR  = join(CLAUDE_DIR, 'projects')
export const CLAUDE_SETTINGS      = join(CLAUDE_DIR, 'settings.json')
export const CLAUDE_DEBUG_DIR     = join(CLAUDE_DIR, 'debug')
// Claude Code's own config sits inside a CLAUDE_CONFIG_DIR, otherwise beside the `.claude` dir (~/.claude.json)
const insideDir                   = CLAUDE_DIR === process.env.CLAUDE_CONFIG_DIR || basename(CLAUDE_DIR) !== '.claude'
export const CLAUDE_CONFIG        = join(insideDir ? CLAUDE_DIR : dirname(CLAUDE_DIR), '.claude.json')
// bin paths assume this file sits two levels below the repo root (true for both src/main and out/main bundle)
export const STATUSLINE_PATH      = join(import.meta.dirname, '../../bin/claude/statusline.mjs')
export const PROXY_PATH           = join(import.meta.dirname, '../../bin/proxy.mjs')


export {LAUNCH_MODES} from 'electron-update-from-npm/launch-mode'
export const LAUNCH_MODE          = launchMode(import.meta.dirname, { dev: import.meta.env?.DEV }) // env is Vite-only, undefined under plain node (test/scripts)
