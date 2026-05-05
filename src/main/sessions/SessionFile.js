import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const SESSIONS_ROOT = path.join(os.homedir(), '.claude', 'sessions')

export async function loadSessionNames() {
  const map = new Map()
  let entries
  try {
    entries = await fsp.readdir(SESSIONS_ROOT, { withFileTypes: true })
  } catch {
    return map
  }
  await Promise.all(entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map(async (e) => {
      try {
        const raw = await fsp.readFile(path.join(SESSIONS_ROOT, e.name), 'utf8')
        const obj = JSON.parse(raw)
        if (obj.sessionId && obj.name) map.set(obj.sessionId, obj.name)
      } catch {}
    }))
  return map
}

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

  async readFrom(offset = 0, range = null) {
    const items = []
    const seenIds = new Set()
    const nextOffset = await this.streamFrom(offset, (obj) => {
      if (range) {
        const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN
        if (Number.isNaN(ts) || ts < range.start || ts > range.end) return
      }
      const u = obj.message?.usage
      const msgId = obj.message?.id
      if (u && msgId && !seenIds.has(msgId)) {
        seenIds.add(msgId)
        obj._tokenDelta = (u.input_tokens || 0) + (u.output_tokens || 0) +
          (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      }
      items.push(obj)
    })
    return { items, nextOffset }
  }
}
