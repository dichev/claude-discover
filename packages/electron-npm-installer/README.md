# electron-npm-installer

Auto-update for Electron apps that people install with npm (`npm i -g my-app` or `npx my-app`).

No installers, no code signing, no release server — npm is already your release channel, so updating is just `npm i -g my-app@latest`. This package does that for you, from inside the app.

## Install

```sh
npm install electron-npm-installer
```

Requires Electron 30+. ESM-only (from CommonJS, use `await import()`).

## Usage

```js
import { checkForUpdate, installUpdate } from 'electron-npm-installer'

const update = await checkForUpdate() // → { name: 'my-app', current: '1.2.0', latest: '1.3.0', mode: 'npm-global' }, or null if up to date
installUpdate()                       // installs that version: closes the app, updates it, opens it again
```

Show a "New version available" button when `checkForUpdate()` returns something, and call `installUpdate()` when it's clicked.

Your app's name and `bin` are read from its `package.json`. Keep this package out of your main-process bundle (most Electron bundlers externalize dependencies by default): it starts its `installer.js` from its own folder.

## What `checkForUpdate()` returns

- **Installed with `npm i -g`:** the new version, if there is one.
- **Run with `npx`:** always returns a result, so you can offer a proper global install (npx's copy is temporary).
- **Run from a repo checkout:** always `null`. Pass `checkForUpdate({ dev: true })` to try the flow anyway; it updates your global install and doesn't reopen.

## Launch mode

```js
import { LAUNCH_MODES, launchMode } from 'electron-npm-installer/launch-mode' // no electron import: plain-node scripts can use it too

launchMode(app.getAppPath()) // → 'npm-global', 'npx-temp' (npx's temporary copy) or 'npm-start' (a repo checkout); 'npm-dev' with { dev: true }
```

## Good to know

- Works with npm only, not pnpm or yarn.
- If the update fails, the old version opens again.

## License

MIT
