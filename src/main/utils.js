import { shell } from 'electron'
import path from 'node:path'

// Local links come from untrusted instruction/memory markdown — only extensions safe to hand to the OS default app;
const VIEWABLE_EXT = new Set(['.md', '.txt', '.json', '.jsonl', '.log', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf'])

export async function openLinkSafely(href, baseFile) {
  if (/^(https?:|mailto:)/i.test(href)) return shell.openExternal(href)
  if (!baseFile) return // only instruction/memory files may resolve a local path

  let decoded
  try { decoded = decodeURIComponent(href) } catch { return } // malformed %-escape
  const baseDir = path.dirname(path.resolve(baseFile))
  const abs = path.resolve(baseDir, decoded)
  const rel = path.relative(baseDir, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return // escapes the base dir (traversal / absolute href / UNC) — refuse
  if (!VIEWABLE_EXT.has(path.extname(abs).toLowerCase())) return shell.showItemInFolder(abs) // not a known document type — reveal, never launch

  const err = await shell.openPath(abs) // returns '' on success, error string otherwise
  if (err) shell.showItemInFolder(abs)  // no associated app (or missing) -> reveal it instead
  return err
}
