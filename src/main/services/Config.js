import fs from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import { sync as writeFileAtomic } from 'write-file-atomic'

const PROJECT_DIR = join(homedir(), '.claude-discover')
const CONFIG_FILE = join(PROJECT_DIR, 'config.json')

// ~/.claude-discover/config.json — this app's own preferences (claudeDir, recents, work_hours)
export class Config {

  read() {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    }
    catch (err) {
      if (err.code !== 'ENOENT') console.warn(`Ignoring unreadable ${CONFIG_FILE}: ${err.message}`) // a corrupted pref file must not kill startup
      return {}
    }
  }

  save(data) {
    fs.mkdirSync(PROJECT_DIR, { recursive: true })
    writeFileAtomic(CONFIG_FILE, JSON.stringify({ ...this.read(), ...data }, null, 2))
  }
}

export const config = new Config() // stateless, so one shared instance serves everyone
