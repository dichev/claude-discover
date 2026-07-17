import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export class SessionFile {
  constructor(filePath) {
    this.filePath = filePath
    // Parent session is the dir segment before the outermost `subagents` (nests deep, e.g. subagents/workflows/<wf>/agent-*).
    const parts = path.dirname(filePath).split(path.sep)
    this.parentSessionId = parts[parts.indexOf('subagents') - 1] ?? null
    // Workflow journals are all named journal.jsonl — qualify with the wf dir so ids stay unique
    const base = path.basename(filePath, '.jsonl')
    this.sessionId = base === 'journal' ? `${parts.at(-1)}-journal` : base
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
