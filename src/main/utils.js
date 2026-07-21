import { shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// extensions safe to open with the OS default app — local links come from untrusted markdown
const VIEWABLE_EXT = new Set(['.md', '.txt', '.json', '.jsonl', '.log', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf'])

export async function openLinkSafely(href, baseFile) {
  if (/^(https?:|mailto:)/i.test(href)) return shell.openExternal(href)
  if (!baseFile) return // only instruction/memory files may resolve a local path

  let decoded
  try { decoded = decodeURIComponent(href) } catch { return } // malformed %-escape
  const baseDir = path.dirname(path.resolve(baseFile))
  const abs = path.resolve(baseDir, decoded)
  const rel = path.relative(baseDir, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return // escapes the base dir — refuse
  if (!VIEWABLE_EXT.has(path.extname(abs).toLowerCase())) return shell.showItemInFolder(abs) // unknown type — reveal, never launch

  const err = await shell.openPath(abs) // '' on success, error string otherwise
  if (err) shell.showItemInFolder(abs)  // couldn't open — reveal instead
  return err
}


// The window must never leave the app's own pages (a remote page would inherit the preload bridge).
// Popups are denied; http(s)/mailto links open in the real browser instead.
const DEV_ORIGIN = process.env.ELECTRON_RENDERER_URL && new URL(process.env.ELECTRON_RENDERER_URL).origin
const APP_PAGES = pathToFileURL(path.join(import.meta.dirname, '../renderer/')).href // other local html would inherit the bridge too

export function lockNavigation(contents) {
  const toBrowser = url => /^(https?|mailto):/i.test(url) && shell.openExternal(url)
  const block = (e, url) => {
    const { href, origin } = new URL(url) // normalized, so ../ segments can't sneak past the prefix check
    if (href.startsWith(APP_PAGES) || origin === DEV_ORIGIN) return
    e.preventDefault()
    toBrowser(url)
  }
  contents.setWindowOpenHandler(({ url }) => {
    toBrowser(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', block)
  contents.on('will-redirect', block)
}