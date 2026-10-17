import { RequestParser } from './RequestParser.js'

// Since 2.1.300 the transcript logs the loop's requests: system + tools per change (api-request-shape),
// each injected message once (api-request-blob), then the request — the rest of it is plain turns.
export class TranscriptInstructions {
  constructor() {
    this.parser = new RequestParser() // holds the dedup state
    this.shape = null // the shape and blobs the next request is the first to send
    this.blobs = []
  }

  // Whether every strip an attachment injects is among the `keys` hashes. A prompt snapshot is
  // Claude Code's own copy of the system prompt and tools the shapes list.
  static listed(obj, keys) {
    if (obj.attachment?.type === 'prompt_snapshot') return keys.size > 0
    const texts = (obj.rendered ?? []).map(r => r.content).filter(t => typeof t === 'string')
    const found = new RequestParser().strips({ request: { messages: [{ role: 'user', content: texts.map(text => ({ type: 'text', text })) }] } })
    return found.length > 0 && found.every(f => keys.has(f.hash))
  }

  // The strips first sent by `obj`, when it is an api-request record — [] for every other line
  feed(obj) {
    if (obj.type === 'api-request-shape') this.shape = obj.shape
    if (obj.type === 'api-request-blob') this.blobs.push(obj.message)
    if (obj.type !== 'api-request') return []
    const rec = { request: { ...this.shape, model: obj.params?.model, messages: this.blobs } }
    this.shape = null
    this.blobs = []
    return this.parser.strips(rec).map(f => ({ timestamp: obj.timestamp, ...f }))
  }
}
