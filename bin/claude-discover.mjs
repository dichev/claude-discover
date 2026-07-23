#!/usr/bin/env node
// Launches the app from an npm install (`npx claude-discover`): points the local
// Electron binary at the package root, whose package.json main is out/main/main.js.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import electron from 'electron' // under plain node the electron package exports its binary path

const appDir = fileURLToPath(new URL('..', import.meta.url))
if (!existsSync(new URL('../out/main/main.js', import.meta.url))) {
  console.error('claude-discover: missing build output — run `npm run build` first')
  process.exit(1)
}

spawn(electron, [appDir, ...process.argv.slice(2)], { stdio: 'inherit' })
  .on('close', code => process.exit(code ?? 0))
