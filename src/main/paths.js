import {homedir} from 'node:os'
import {join} from 'node:path'
import {config} from './config/ConfigFile.js'

const local = config.read()
export const DATA_DIR             = config.dataDir
export const CLAUDE_DIR           = local.claudeDir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
export const RECENT_CLAUDE_DIRS   = local.recents || [CLAUDE_DIR]
export const CLAUDE_PROJECTS_DIR  = join(CLAUDE_DIR, 'projects')
export const CLAUDE_SETTINGS      = join(CLAUDE_DIR, 'settings.json')
// bin paths assume this file sits two levels below the repo root (true for both src/main and out/main bundle)
export const STATUSLINE_PATH      = join(import.meta.dirname, '../../bin/claude/statusline.mjs')
export const PROXY_PATH           = join(import.meta.dirname, '../../bin/proxy.mjs')
export const UPDATE_PATH          = join(import.meta.dirname, '../../bin/update.mjs')


export const LAUNCH_MODES         = { NPM_DEV: 'npm-dev', NPM_START: 'npm-start', NPX_TEMP: 'npx-temp', NPM_GLOBAL: 'npm-global' }
export const LAUNCH_MODE          = detectLaunchMode()

function detectLaunchMode() {
  const dirs = import.meta.dirname.split(/[\\/]/)
  if (import.meta.env.DEV) return LAUNCH_MODES.NPM_DEV              // `npm run dev` from a repo checkout
  if (dirs.includes('_npx')) return LAUNCH_MODES.NPX_TEMP          // `npx claude-discover`, run out of a cache dir (~/.npm/_npx/<hash>) that is deleted later
  if (dirs.includes('node_modules')) return LAUNCH_MODES.NPM_GLOBAL // `npm i -g claude-discover`
  return LAUNCH_MODES.NPM_START                                     // `npm start` — a built repo checkout (also the "(local)" shortcut)
}
