import {homedir} from 'node:os'
import {join} from 'node:path'

export const CLAUDE_DIR           = join(homedir(), '.claude')
export const CLAUDE_PROJECTS_DIR  = join(CLAUDE_DIR, 'projects')
export const WORK_HOURS           = join(CLAUDE_DIR, '.work-hours.json')
