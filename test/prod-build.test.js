import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Greps a real prod build for invariants that fail silently or only at runtime
describe('prod build', () => {
  const outDir = join(ROOT, 'node_modules/.cache/claude-discover/prod-build') // temporary dir, vite empties it each build because it is inside root
  const read = file => readFileSync(join(outDir, file), 'utf-8')

  beforeAll(() => {
    execSync(`npm run build -- --outDir "${outDir}"`, { cwd: ROOT, stdio: 'pipe' })
  }, 120_000)

  it('compiles debug.js out entirely', () => {
    const main = read('main/main.js')
    expect(readdirSync(join(outDir, 'main'))).toEqual(['main.js']) // no code-split debug chunk either
    expect(main).toContain('whenReady') // sanity: a real bundle, not vacuously empty
    for (const marker of ['debug.js', 'remote-debugging-port', '9333', 'electron-devtools-installer'])
      expect(main).not.toContain(marker) // strings that exist only in src/main/debug.js
  })

  it('injects the CSP meta tag and no inline scripts into both HTML entries', () => {
    for (const page of ['renderer/index.html', 'renderer/find/find.html']) {
      const html = read(page)
      expect(html).toContain('http-equiv="Content-Security-Policy"')
      expect(html).toContain('script-src &#39;self&#39;') // quotes are html-escaped in the meta attr
      for (const tag of html.match(/<script\b[^>]*>/g) ?? [])
        expect(tag).toContain('src=') // an inline script would be blocked by (or force loosening) the CSP
    }
  })

  it('emits the two sandboxed preloads as self-contained CJS', () => {
    const preloads = readdirSync(join(outDir, 'preload')).sort()
    expect(preloads).toEqual(['findPreload.cjs', 'preload.cjs'])
    for (const file of preloads)
      expect(read(`preload/${file}`)).not.toMatch(/require\(["']\.\.?\//) // sandboxed preloads can't require local chunks
  })

  it('replaces __APP_VERSION__ with the real version in the renderer', () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
    const bundle = readdirSync(join(outDir, 'renderer/assets')).find(f => /^index-.*\.js$/.test(f))
    expect(read(`renderer/assets/${bundle}`)).not.toContain('__APP_VERSION__')
    expect(read(`renderer/assets/${bundle}`)).toContain(`"${version}"`)
  })
})
