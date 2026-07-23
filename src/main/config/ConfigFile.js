import fs from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import { sync as writeFileAtomic } from 'write-file-atomic'

// ~/.claude-discover/config.json — this app's own preferences (claudeDir, recents, work_hours)
class ConfigFile {
  dataDir    = join(homedir(), '.claude-discover')
  configFile = join(this.dataDir, 'config.json')

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.configFile, 'utf8'))
    }
    catch (err) {
      if (err.code !== 'ENOENT') console.warn(`Ignoring unreadable ${this.configFile}: ${err.message}`) // a corrupted pref file must not kill startup
      return {}
    }
  }

  save(data) {
    fs.mkdirSync(this.dataDir, { recursive: true })
    writeFileAtomic(this.configFile, JSON.stringify({ ...this.read(), ...data }, null, 2))
  }
}

export const config = new ConfigFile() // stateless, so one shared instance serves everyone
