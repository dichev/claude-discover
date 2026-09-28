// Updates an `npm i -g` install from outside it. AutoUpdate starts it detached as the app quits:
// Windows locks the app's running electron.exe, so npm can only replace the package once the app is gone.
//
// Usage: node bin/update.mjs <pid> <version> [<electron> <appDir>]   (without them nothing reopens, as from dev)

import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const [pid, version, electron, appDir] = process.argv.slice(2)

while (isRunning(pid)) await sleep(200)

try {
  // Into the helper's console window (@windows), where --loglevel=http lists each package as npm fetches it
  const { status } = spawnSync(`npm i -g claude-discover@${version} --loglevel=http`, { shell: true, stdio: 'inherit' })
  if (status !== 0) await sleep(5_000) // leaves npm's error readable before the window closes
} finally {
  // Reopen even when the update failed, so the user is never left without the app
  if (electron) spawn(electron, [appDir], { detached: true, stdio: 'ignore' }).unref()
}

function isRunning(pid) {
  try {
    process.kill(Number(pid), 0)
    return true
  } catch (err) {
    return err.code === 'EPERM' // alive, just not ours to signal
  }
}
