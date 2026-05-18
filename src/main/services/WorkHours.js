import {getConfig, setConfig} from '../paths.js'

const DEFAULT = { work_hours: { start: '09:00', end: '17:00' } }

export class WorkHours {
  read() {
    const { work_hours } = getConfig()
    return work_hours ? { work_hours } : DEFAULT
  }

  write(data) {
    setConfig({ work_hours: data.work_hours })
    return data
  }
}
