#!/usr/bin/env node
// Launches the app from an npm install (`npx claude-discover`): points the local
// Electron binary at the package root, whose package.json main is out/main/main.js.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, constants } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
if (!existsSync(new URL('../out/main/main.js', import.meta.url))) {
  console.error('claude-discover: missing build output — run `npm run build` first')
  process.exit(1)
}


if (process.platform === 'linux') { // @linux
  // Importing electron downloads its binary on first run, which can't unzip into a root-owned `sudo npm i -g` install,
  // so it's imported dynamically, only after this check (a static import is hoisted and would run first)

  const electronDir = new URL('.', import.meta.resolve('electron'))
  const isWritable = await access(electronDir, constants.W_OK).then(() => true, () => false)
  if (!existsSync(new URL('path.txt', electronDir)) && !isWritable) {
    console.error(`
Electron can't finish installing — its folder isn't writable by your user.

Global npm packages shouldn't need sudo. The recommended setup is Node from a version
manager like nvm, which keeps global npm packages in your home folder:

  sudo npm uninstall -g claude-discover
  wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash

Then open a new terminal and run:

  nvm install --lts
  npm install -g claude-discover
  claude-discover

See https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally`)
    process.exit(1)
  }
}


const { default: electron } = await import('electron') // under plain node the electron package exports its binary path

spawn(electron, [appDir, ...process.argv.slice(2)], { stdio: 'inherit' })
  .on('close', code => process.exit(code ?? 0))
