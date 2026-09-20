import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export class SessionFile {
  constructor(filePath) {
    this.filePath = filePath
    // Parent session is the dir segment before the outermost `subagents` (nests deep, e.g. subagents/workflows/<wf>/agent-*);
    // its transcript sits beside that dir under the same name.
    const parts = path.dirname(filePath).split(path.sep)
    const i = parts.indexOf('subagents')
    this.parentSessionId = i > 0 ? parts[i - 1] : null
    this.parentFilePath = i > 0 ? parts.slice(0, i).join(path.sep) + '.jsonl' : null
    // Workflow journals are all named journal.jsonl — qualify with the wf dir so ids stay unique
    const base = path.basename(filePath, '.jsonl')
    this.sessionId = base === 'journal' ? `${parts.at(-1)}-journal` : base
  }

  async stat() {
    try { return await fsp.stat(this.filePath) } catch { return null }
  }

  // Streams every complete line as parsed JSON; a partially-written trailing line
  // (no newline yet) is skipped, so reading a live session never sees a half record.
  async stream(onLine) {
    let leftover = ''
    await new Promise((resolve) => {
      const stream = fs.createReadStream(this.filePath, { encoding: 'utf8' })
      stream.on('data', (chunk) => {
        leftover += chunk
        let idx
        while ((idx = leftover.indexOf('\n')) !== -1) {
          const raw = leftover.slice(0, idx)
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
  }

}
