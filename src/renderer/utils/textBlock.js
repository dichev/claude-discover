/*
  Detect JSON/Python dict blocks in text and wrap them in fenced code blocks.

  Example:
    IN:  Some result: {"status": "ok", "count": 3}
         And some data {'name': 'Alice', 'age': 30}
    ->
    OUT: Some result: ```json{"status": "ok", "count": 3}```
         And some data: ```python {'name': 'Alice', 'age': 30}```
*/

const detectLang = (body, limit = 500) => {
  if (body[0] === '[') return 'json'
  const snippet = body.length > limit ? body.slice(0, limit) : body
  if (/"[^"]*"\s*:/.test(snippet)) return 'json'
  if (/'[^']*'\s*:/.test(snippet)) return 'python'
  return null
}

const findMatchingClose = (text, start) => {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === open) depth++
    else if (c === close && --depth === 0) return i + 1
  }
  return -1
}

// Odd number of ``` lines before an offset => it's inside an open fence; leave it alone (already highlighted).
const insideFence = (text, i) => (text.slice(0, i).match(/^```/gm)?.length ?? 0) % 2

export function fenceBlocks(text) {
  if (typeof text !== 'string') return text
  if (!text.includes('{') && !text.includes('[')) return text

  const startRe = /^([^\n{[]*)[{[]/gm
  let out = '', cursor = 0, m
  while ((m = startRe.exec(text)) !== null) {
    const bodyStart = m.index + m[1].length
    if (insideFence(text, bodyStart)) continue
    const end = findMatchingClose(text, bodyStart)
    if (end < 0) continue
    if (end !== text.length && text[end] !== '\n' && text[end] !== '\r') continue
    const body = text.slice(bodyStart, end)
    const lang = detectLang(body)
    if (!lang) continue
    out += text.slice(cursor, m.index) + m[1].trimEnd() + '\n```' + lang + '\n' + body + '\n```\n'
    cursor = startRe.lastIndex = end
  }
  return out + text.slice(cursor)
}

// Markdown treats a `<tag>` line as a raw HTML block that swallows everything up to the next blank line
// unformatted, and ReactMarkdown shows raw HTML as literal text anyway. Fence whole <tag>…</tag> blocks
// as ```xml (syntax-highlighted, like fenceBlocks does for JSON) and wrap stray tags in inline code spans,
// so the text around them stays markdown-formatted. Autolinks (<https://…>, <a@b.c>) match neither pattern.
export function fenceTags(text) {
  if (typeof text !== 'string' || !text.includes('<')) return text

  // <tag> opening a line … matching </tag> ending a line -> one ```xml fence around the whole block.
  const startRe = /^<([A-Za-z][\w-]*)(?:\s[^<>`\n]*)?>/gm
  let out = '', cursor = 0, m
  while ((m = startRe.exec(text)) !== null) {
    if (insideFence(text, m.index)) continue
    const close = text.indexOf(`</${m[1]}>`, m.index)
    if (close < 0) continue
    const end = close + m[1].length + 3
    if (end !== text.length && text[end] !== '\n' && text[end] !== '\r') continue
    out += text.slice(cursor, m.index) + '```xml\n' + text.slice(m.index, end) + '\n```'
    cursor = startRe.lastIndex = end
  }
  out += text.slice(cursor)

  // Tags left outside a fenced pair render as monospace chips instead of triggering markdown's raw-HTML mode.
  return out
    .split(/(^```[^\n]*\n[\s\S]*?\n```|`[^`\n]+`)/m) // odd parts are fenced blocks / inline code spans — keep verbatim
    .map((part, i) => i % 2 ? part : part.replace(/<\/?[A-Za-z][\w-]*(?:\s[^<>`\n]*)?\/?>/g, '`$&`'))
    .join('')
}


// Split long markdown into standalone chunks at blank lines outside code fences, so a huge
// block can render one ReactMarkdown per chunk (lazy-mounted) instead of parsing everything
// at once. Text with no safe split point (e.g. one giant fence) comes back as a single chunk.
export function splitMarkdown(text, size = 10_000) {
  if (typeof text !== 'string' || text.length <= size) return [text]
  const chunks = []
  let buf = [], len = 0, inFence = false
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence
    if (len > size && !inFence && line.trim() === '') {
      chunks.push(buf.join('\n'))
      buf = []; len = 0
      continue // the blank separator is dropped; chunks stay standalone paragraphs
    }
    buf.push(line)
    len += line.length + 1
  }
  if (buf.length) chunks.push(buf.join('\n'))
  return chunks
}

// CLI command output carries ANSI SGR/cursor codes (bold model names, the 256-color context-usage bar) — strip them for plain-text display.
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')

export function parseCommand(text) {
  if (typeof text !== 'string') return null
  // Anchored to the start: real command records begin with one of these tags (see SessionParser).
  // Prose that merely *mentions* a tag mid-text (e.g. an assistant reply discussing hooks) must
  // not parse as a command — it would render as an empty command block.
  if (!/^\s*<(command-name|command-message|local-command-stdout|local-command-caveat)>/.test(text)) return null
  const field = tag => stripAnsi(text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '')
  return {
    name:    field('command-name'),
    message: field('command-message'),
    args:    field('command-args'),
    stdout:  field('local-command-stdout'),
    caveat:  field('local-command-caveat'),
  }
}
