import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const workDir = join(ROOT, 'node_modules/.cache/claude-discover/prod-build')
const pkg = JSON.parse(fs.readFileSync(join(ROOT, 'package.json'), 'utf8'))

// One `npm pack` feeds both suites: prepack rebuilds out/ (checked by the first),
// then packs it into the tarball that ships (checked by the second)
beforeAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })
  execSync(`npm pack --pack-destination "${workDir}"`, { cwd: ROOT, stdio: 'pipe' })
}, 120_000)

// Bundle invariants of the prod build that fail silently or only at runtime
describe('prod build (out/)', () => {
  const read = file => fs.readFileSync(join(ROOT, 'out', file), 'utf8')

  it('compiles debug.js out entirely', () => {
    expect(fs.readdirSync(join(ROOT, 'out/main'))).toEqual(['main.js']) // no code-split debug chunk either
    const main = read('main/main.js')
    expect(main).toContain('whenReady') // sanity: a real bundle, not vacuously empty
    for (const marker of ['debug.js', 'remote-debugging-port', '9333', 'electron-devtools-installer']) {
      expect(main).not.toContain(marker) // strings that exist only in src/main/debug.js
    }
  })

  it('injects the CSP meta tag and no inline scripts into every HTML entry', () => {
    const pages = fs.readdirSync(join(ROOT, 'src/renderer'), { recursive: true }).filter(f => f.endsWith('.html'))
    expect(pages.length).toBeGreaterThan(0) // each src page lands at the same relative path in out/renderer
    for (const page of pages) {
      const html = read(join('renderer', page))
      expect(html).toContain('http-equiv="Content-Security-Policy"')
      expect(html).toContain('script-src &#39;self&#39;') // quotes are html-escaped in the meta attr
      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
        expect(tag).toContain('src=') // an inline script would be blocked by (or force loosening) the CSP
      }
    }
  })

  it('emits each sandboxed preload as self-contained CJS', () => {
    const preloads = fs.readdirSync(join(ROOT, 'src/preload')).map(f => f.replace(/\.js$/, '.cjs')).sort()
    expect(fs.readdirSync(join(ROOT, 'out/preload')).sort()).toEqual(preloads) // one .cjs per source — no shared chunk, which the sandbox couldn't require
    for (const file of preloads) {
      expect(read(`preload/${file}`)).not.toMatch(/require\(["']\.\.?\//) // ...nor may a preload require one itself
    }
  })

  it('replaces __APP_VERSION__ with the real version in the renderer', () => {
    const bundle = fs.readdirSync(join(ROOT, 'out/renderer/assets')).find(f => /^index-.*\.js$/.test(f))
    const code = read(`renderer/assets/${bundle}`)
    expect(code).not.toContain('__APP_VERSION__')
    expect(code).toContain(`"${pkg.version}"`)
  })
})

// What actually ships: the tarball's file list (out/ ships wholesale, so its contents are covered above)
describe('npm package (tarball)', () => {
  let shipped = [] // tarball-relative paths

  beforeAll(() => {
    const filename = `${pkg.name}-${pkg.version}.tgz` // deterministic — npm pack's stdout is polluted by prepack output
    // relative path — MSYS tar reads C:\… as host:path
    shipped = execSync(`tar -tf "${filename}"`, {cwd: workDir})
      .toString().trim().split('\n')
      .map(l => l.trim().replace(/^package\//, ''))
  })

  it('ships a publishable manifest, every files entry, and no sources', () => {
    expect(pkg.private).toBeUndefined()
    expect(pkg.dependencies.electron).toBeDefined() // devDependencies are not installed by npx
    expect(shipped).toContain(pkg.main)
    expect(shipped).toContain(pkg.bin['claude-discover'])
    for (const entry of pkg.files) { // npm pack silently skips an entry gone stale after a rename/delete
      expect(shipped.some(f => f === entry || f.startsWith(`${entry}/`)), `files entry "${entry}" shipped nothing`).toBe(true)
    }
    expect(shipped.filter(p => /^(src|test)\//.test(p)), 'sources must not be published').toEqual([])
  })

  it('ships only git-committed files', () => {
    // whole dirs in the files whitelist ship everything inside — gitignored or uncommitted strays would go out silently
    const tracked = new Set(execSync('git ls-files', { cwd: ROOT, stdio: 'pipe' }).toString().split('\n'))
    const strays = shipped.filter(f => !f.startsWith('out/') && !tracked.has(f)) // out/ is the build output itself
    expect(strays, 'files not committed to git must not be published').toEqual([])
  })
})
