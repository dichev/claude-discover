import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const FILE_PATH = path.join(os.homedir(), '.claude', '.work-hours.json')
const DEFAULT = { work_hours: { start: '09:00', end: '17:00' } }

export function readWorkHours() {
  try {
    return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'))
  } catch {
    return DEFAULT
  }
}

export function writeWorkHours(data) {
  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true })
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2) + '\n')
  return data
}
