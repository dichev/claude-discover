// Detect JSON/Python dict blocks in text and wrap them in fenced code blocks, e.g.
//   Some result: {"status": "ok"}  →  Some result: ```json {"status": "ok"} ```

const detectLang = (body, limit = 500) => {
  if (body[0] === '[') return 'json'
  const snippet = body.length > limit ? body.slice(0, limit) : body
  if (/"[^"]*"\s*:/.test(snippet)) return 'json'
  if (/'[^']*'\s*:/.test(snippet)) return 'python'
  return null
}

// The end of each { or [ by counting only its own kind, found in one pass: scanning on from every
// opener went quadratic on long text with brackets left open
function bracketEnds(text) {
  const ends = new Map(), open = { '{': [], '[': [] }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '{' || c === '[') open[c].push(i)
    else if (c === '}' || c === ']') {
      const start = open[c === '}' ? '{' : '['].pop()
      if (start != null) ends.set(start, i + 1)
    }
  }
  return ends
}

// A fence closes only on a backtick run at least as long as its opener, so ``` lines stay literal inside ````.
const FENCED = /^(`{3,})[^`\n]*\n(?:[\s\S]*?\n)?\1/gm
const FENCED_OR_OPEN = new RegExp(FENCED.source + '|^```', 'gm')
const FENCED_CODE_OR_TAG = new RegExp(FENCED.source + /|`[^`\n]+`|<\/?[A-Za-z][\w-]*(?:\s[^<>`\n]*)?\/?>/.source, 'gm')

// An offset inside a closed fence, or anywhere after a ``` line left unclosed, is already highlighted; leave it alone.
// The fences are found once per text: re-scanning the prefix per offset went quadratic on big pasted logs.
function fenceTest(text) {
  const spans = []
  let open = Infinity
  for (const m of text.matchAll(FENCED_OR_OPEN)) {
    if (m[1]) spans.push([m.index, m.index + m[0].length])
    else { open = m.index; break }
  }
  return i => i > open || spans.some(([s, e]) => s < i && i < e)
}

// One backtick longer than any run inside (and `min` at least), so the text's own fences can't close it
export function fenced(body, lang = '', min = 3) {
  const longest = (body.match(/`+/g) ?? []).reduce((n, r) => Math.max(n, r.length), 0)
  const ticks = '`'.repeat(Math.max(min, longest + 1))
  return ticks + lang + '\n' + body + '\n' + ticks
}

export function fenceBlocks(text) {
  if (typeof text !== 'string') return text
  if (!text.includes('{') && !text.includes('[')) return text

  const insideFence = fenceTest(text)
  const ends = bracketEnds(text)
  const startRe = /^([^\n{[]*)[{[]/gm
  let out = '', cursor = 0, m
  while ((m = startRe.exec(text)) !== null) {
    const bodyStart = m.index + m[1].length
    if (insideFence(bodyStart)) continue
    const end = ends.get(bodyStart)
    if (end == null) continue
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

  // <tag> opening a line … matching </tag> ending a line -> one ````xml fence around the whole block
  // (four backticks at least, and more than any run inside, so fences inside it, e.g. a transcript's, stay literal).
  const insideFence = fenceTest(text)
  const startRe = /^<([A-Za-z][\w-]*)(?:\s[^<>`\n]*)?>/gm
  let out = '', cursor = 0, m, body = null // the open fence's text, written out once no further pair joins it
  const flush = () => body == null ? '' : fenced(body, 'xml', 4)
  // Each tag's next closer (-1: none left), searched again only once passed, so unclosed tags don't each rescan the rest
  const closes = new Map()
  while ((m = startRe.exec(text)) !== null) {
    if (insideFence(m.index)) continue
    let close = closes.get(m[1])
    if (close == null || (close >= 0 && close < m.index)) closes.set(m[1], close = text.indexOf(`</${m[1]}>`, m.index))
    if (close < 0) continue
    const end = close + m[1].length + 3
    if (end !== text.length && text[end] !== '\n' && text[end] !== '\r') continue
    const gap = text.slice(cursor, m.index), pair = text.slice(m.index, end)
    // Pairs separated only by blank lines share the previous fence instead of stacking one block per tag.
    if (body != null && !gap.trim()) body += gap + pair
    else { out += flush() + gap; body = pair }
    cursor = startRe.lastIndex = end
  }
  out += flush() + text.slice(cursor)

  // Tags left outside a fenced pair render as monospace chips instead of triggering markdown's raw-HTML mode.
  // Fenced blocks and inline code spans match first and stay verbatim.
  return out.replace(FENCED_CODE_OR_TAG, m => m[0] === '<' ? '`' + m + '`' : m)
}


// Split long markdown into standalone chunks at blank lines outside code fences, so a huge
// block can render one ReactMarkdown per chunk (lazy-mounted) instead of parsing everything
// at once. Text with no safe split point (e.g. one giant fence) comes back as a single chunk.
export function splitMarkdown(text, size = 10_000) {
  if (typeof text !== 'string' || text.length <= size) return [text]
  const chunks = []
  let buf = [], len = 0, fence = '' // the open fence's backtick run
  for (const line of text.split('\n')) {
    const run = line.match(/^`{3,}/)?.[0]
    if (run && !fence) fence = run
    else if (run && run.length >= fence.length) fence = ''
    if (len > size && !fence && line.trim() === '') {
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