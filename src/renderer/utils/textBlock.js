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

export function fenceBlocks(text) {
  if (typeof text !== 'string') return text
  if (!text.includes('{') && !text.includes('[')) return text

  // Odd number of ``` lines before an offset => it's inside an open fence; skip it (already highlighted).
  const insideFence = i => (text.slice(0, i).match(/^```/gm)?.length ?? 0) % 2

  const startRe = /^([^\n{[]*)([{[])/gm
  let out = '', cursor = 0, m
  while ((m = startRe.exec(text)) !== null) {
    const [, prefix, open] = m
    const bodyStart = m.index + prefix.length
    if (!insideFence(bodyStart)) {
        const end = findMatchingClose(text, bodyStart)
        if (end < 0) continue
        if (end !== text.length && text[end] !== '\n' && text[end] !== '\r') continue
        const body = text.slice(bodyStart, end)
        const lang = detectLang(body)
        if (!lang) continue
        const fence = '\n```' + lang + '\n' + body + '\n```\n'
        out += text.slice(cursor, m.index) + prefix.trimEnd() + fence
        cursor = startRe.lastIndex = end
      }
  }
  return out + text.slice(cursor)
}

// CLI command output carries ANSI SGR/cursor codes (bold model names, the 256-color context-usage bar) — strip them for plain-text display.
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')

export function parseCommand(text) {
  if (typeof text !== 'string') return null
  if (!text.includes('<command-name>') && !text.includes('<local-command-stdout>') && !text.includes('<local-command-caveat>')) return null
  const name    = text.match(/<command-name>([\s\S]*?)<\/command-name>/)
  const message = text.match(/<command-message>([\s\S]*?)<\/command-message>/)
  const args    = text.match(/<command-args>([\s\S]*?)<\/command-args>/)
  const stdout  = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)
  const caveat  = text.match(/<local-command-caveat>([\s\S]*?)<\/local-command-caveat>/)
  return {
    name: name ? stripAnsi(name[1]) : '',
    message: message ? stripAnsi(message[1]) : '',
    args: args ? stripAnsi(args[1]) : '',
    stdout: stdout ? stripAnsi(stdout[1]) : '',
    caveat: caveat ? stripAnsi(caveat[1]) : '',
  }
}
