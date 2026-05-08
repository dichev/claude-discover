import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const FILE_PATH = path.join(os.homedir(), '.claude', '.work-hours.json')
const DEFAULT = { work_hours: { start: '09:00', end: '17:00' } }

export class WorkHours {
  constructor(filePath = FILE_PATH) {
    this.filePath = filePath
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
    } catch {
      return DEFAULT
    }
  }

  write(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2) + '\n')
    return data
  }
}
