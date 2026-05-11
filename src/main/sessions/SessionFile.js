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

  readText() {
    return fsp.readFile(this.filePath, 'utf8')
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
    let tokenTotal = 0
    let prevMessage = null
    const nextOffset = await this.streamFrom(offset, (obj) => {
      if (range) {
        const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN
        if (Number.isNaN(ts) || ts < range.start || ts > range.end) return
      }
      // Standalone attachment entries are always harness-injected context
      // (diagnostics, task_reminder, selected_lines_in_ide, etc.), never user input.
      if (obj.type === 'attachment') obj.isMeta = true
      const u = obj.message?.usage
      const msgId = obj.message?.id
      if (u && msgId && !seenIds.has(msgId)) {
        seenIds.add(msgId)
        const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
        const output = u.output_tokens || 0
        // Attribute input tokens to the turn that caused the call (user prompt or tool_result),
        // not the assistant — the model is billed for *reading* the preceding turn.
        const inputTarget = prevMessage && prevMessage._tokenDelta == null ? prevMessage : obj
        tokenTotal += input
        inputTarget._tokenDelta = (inputTarget._tokenDelta || 0) + input
        inputTarget._tokenTotal = tokenTotal
        tokenTotal += output
        obj._tokenDelta = (obj._tokenDelta || 0) + output
        obj._tokenTotal = tokenTotal
      }
      items.push(obj)
      if (obj.type === 'user' || obj.type === 'assistant' || obj.type === 'attachment') prevMessage = obj
    })
    return { items, nextOffset }
  }
}
