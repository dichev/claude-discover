// Updates an `npm i -g` install from outside it. AutoUpdate starts it detached as the app quits:
// Windows locks the app's running electron.exe, so npm can only replace the package once the app is gone.

import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'


// ── 1. CLI, then wait for the app to exit ────────────────────────────────────

const { values, positionals: [pid, version] } = parseArgs({
  allowPositionals: true,
  options: {
    'no-reopen': { type: 'boolean' },
    'help':      { type: 'boolean', short: 'h' },
  },
})

if (values.help || !version) {
  console.error('Usage: node bin/update.mjs <pid> <version> [--no-reopen]')
  process.exit(1)
}

while (true) {
  try {
    process.kill(Number(pid), 0)
  } catch (err) {
    if (err.code !== 'EPERM') break // EPERM: alive, just not ours to signal
  }
  await sleep(200)
}


// ── 2. Update and reopen ─────────────────────────────────────────────────────

const { status } = spawnSync(`npm i -g claude-discover@${version} --loglevel=http`, { shell: true, stdio: 'inherit' })
if (status !== 0) await sleep(5_000) // leaves npm's error readable before the window closes

// Reopen even after a failed update; dev passes --no-reopen, as its Vite renderer died with the app
const globalBin = path.join(spawnSync('npm root -g', { shell: true, encoding: 'utf8' }).stdout.trim(), 'claude-discover/bin/claude-discover.mjs')
if (!values['no-reopen']) spawn(process.execPath, [globalBin], { detached: true, stdio: 'ignore' }).unref()
