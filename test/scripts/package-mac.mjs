// @macOS Builds dist/claude-discover.app — the local bundle that owns the claude-discover:// scheme.
// Run it, then `open` the bundle to start the app. It repackages only when the last build is newer,
// and registers the bundle with Launch Services every time.
//
// Why a bundle:  macOS hands claude-discover:// links only to .app bundles — and because this one
//                *is* the app, links reach its own open-url handler, with no forwarder in between.
// Why unsigned:  quarantine is stamped by whatever downloads a file, so a bundle built right here
//                never carries it — no signing, no Gatekeeper prompt.
import { packager } from '@electron/packager'
import { execFileSync } from 'node:child_process'
import { renameSync, rmSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

if (process.platform !== 'darwin') throw new Error('package-mac runs on macOS only — the .app framework uses symlinks')

const root  = fileURLToPath(new URL('../..', import.meta.url))
const dist  = join(root, 'dist')
const app   = join(dist, 'claude-discover.app')
const build = join(root, 'out/main/main.js')
const mtime = file => statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0 // 0 when absent

if (mtime(app) < mtime(build)) { // missing, or stale since the last npm run build
  const [staged] = await packager({
    dir: root,
    out: dist,
    overwrite: true,
    platform: 'darwin',                                  // host arch by default — no fat universal build
    appBundleId: 'com.claudediscover.app',               // stable identity, so open-url routes into the running window
    asar: false,                                         // bin/ scripts are run by plain node, so they can't live inside an asar
    protocols: [{ name: 'Claude Discover', schemes: ['claude-discover'] }],
    prune: true,                                         // drop devDependencies from the bundle
    ignore: [                                            // dist/ and the lockfile are dropped by the packager itself
      /^\/(src|test)\//, /^\/\./,                        // repo-only sources, and every root dot-dir (.git, .idea, .claude)
      /^\/electron\.vite\.config\.js$/, /\.ignore\.|\.tgz$/,
      /^\/node_modules\/electron\//,                     // the packager supplies its own Electron runtime
    ],
  })
  rmSync(app, { recursive: true, force: true })
  renameSync(join(staged, 'claude-discover.app'), app)   // out of packager's claude-discover-darwin-<arch>/ dir,
  rmSync(staged, { recursive: true, force: true })       // so the launcher needs no arch in the path
  utimesSync(app, new Date(), new Date())                // the bundle dir inherits its mtime from the extracted Electron
} else {                                                 // zip (a release date, always older than out/) — stamp it as new
  console.log('Bundle is up to date since the last build')
}

// Claim claude-discover:// for this bundle — harmless to repeat, and never worth blocking the launch
try {
  execFileSync(LSREGISTER, ['-f', app])
} catch {
  console.warn('WARNING: lsregister failed — deep links may not open')
}

console.log(`Ready: ${app}`)
