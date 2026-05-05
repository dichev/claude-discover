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

  const startRe = /^([^\n{[]*)([{[])/gm
  let out = '', cursor = 0, m
  while ((m = startRe.exec(text)) !== null) {
    const [, prefix, open] = m
    const bodyStart = m.index + prefix.length
    const end = findMatchingClose(text, bodyStart)
    if (end < 0) continue
    if (end !== text.length && text[end] !== '\n') continue
    const body = text.slice(bodyStart, end)
    const lang = detectLang(body)
    if (!lang) continue
    const fence = '\n```' + lang + '\n' + body + '\n```\n'
    out += text.slice(cursor, m.index) + prefix.trimEnd() + fence
    cursor = startRe.lastIndex = end
  }
  return out + text.slice(cursor)
}

export function parseCommand(text) {
  if (typeof text !== 'string' || !text.includes('<command-name>')) return null
  const name    = text.match(/<command-name>([\s\S]*?)<\/command-name>/)
  const message = text.match(/<command-message>([\s\S]*?)<\/command-message>/)
  const args    = text.match(/<command-args>([\s\S]*?)<\/command-args>/)
  const stdout = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)
  return {
    name: name ? name[1] : '',
    message: message ? message[1] : '',
    args: args ? args[1] : '',
    stdout: stdout ? stdout[1] : '',
  }
}
