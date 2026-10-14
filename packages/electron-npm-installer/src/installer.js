// Updates an `npm i -g` install from outside it, as Windows locks the app's running electron.exe until the app quits.
// Node built-ins only — this file sits inside the package npm is replacing.

import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'


// ── 1. CLI, then wait for the app to exit ────────────────────────────────────

const { values, positionals: [pid, name, version] } = parseArgs({
  allowPositionals: true,
  options: {
    'reopen': { type: 'string' },
    'help':   { type: 'boolean', short: 'h' },
  },
})

if (values.help || !version) {
  console.error('Usage: node installer.js <pid> <package> <version> [--reopen <bin path inside the package>]')
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

const { status } = spawnSync(`npm i -g ${name}@${version} --loglevel=http`, { shell: true, stdio: 'inherit' })
if (status !== 0) await sleep(5_000) // leaves npm's error readable before the window closes

// Reopen even after a failed update
if (values.reopen) {
  const bin = path.join(spawnSync('npm root -g', { shell: true, encoding: 'utf8' }).stdout.trim(), name, values.reopen)
  spawn(process.execPath, [bin], { detached: true, stdio: 'ignore' }).unref()
}
