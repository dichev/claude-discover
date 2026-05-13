import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export class SessionFile {
  constructor(filePath) {
    this.filePath = filePath
    this.sessionId = path.basename(filePath, '.jsonl')
    const parentDir = path.dirname(filePath)
    this.parentSessionId = path.basename(parentDir) === 'subagents' ? path.basename(path.dirname(parentDir)) : null
  }

  async stat() {
    try { return await fsp.stat(this.filePath) } catch { return null }
  }

  async streamFrom(offset, onLine) {
    let consumed = 0
    let leftover = ''
    await new Promise((resolve) => {
      const stream = fs.createReadStream(this.filePath, { encoding: 'utf8', start: offset })
      stream.on('data', (chunk) => {
        leftover += chunk
        let idx
        while ((idx = leftover.indexOf('\n')) !== -1) {
          const raw = leftover.slice(0, idx)
          consumed += Buffer.byteLength(raw, 'utf8') + 1
          leftover = leftover.slice(idx + 1)
          const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
          if (!line) continue
          let obj
          try { obj = JSON.parse(line) } catch { continue }
          onLine(obj)
        }
      })
      stream.on('close', resolve)
      stream.on('error', resolve)
    })
    return offset + consumed
  }
}
