// Updates an `npm i -g` install from outside it. AutoUpdate starts it detached as the app quits:
// Windows locks the app's running electron.exe, so npm can only replace the package once the app is gone.
//
// Usage: node bin/update.mjs <pid> <version> [--no-reopen]   (dev passes --no-reopen)

import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const [pid, version, noReopen] = process.argv.slice(2)

while (isRunning(pid)) await sleep(200)

try {
  // Into the helper's console window (@windows), where --loglevel=http lists each package as npm fetches it
  const { status } = spawnSync(`npm i -g claude-discover@${version} --loglevel=http`, { shell: true, stdio: 'inherit' })
  if (status !== 0) await sleep(5_000) // leaves npm's error readable before the window closes
} finally {
  // Reopen the global install (the one just updated, or just created from an npx run), even when the update failed
  if (!noReopen) {
    const root = spawnSync('npm root -g', { shell: true, encoding: 'utf8' }).stdout.trim()
    spawn(process.execPath, [path.join(root, 'claude-discover/bin/claude-discover.mjs')], { detached: true, stdio: 'ignore' }).unref()
  }
}

function isRunning(pid) {
  try {
    process.kill(Number(pid), 0)
    return true
  } catch (err) {
    return err.code === 'EPERM' // alive, just not ours to signal
  }
}
