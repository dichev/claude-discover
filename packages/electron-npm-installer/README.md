# electron-npm-installer

What an installer would give your Electron app, for apps that people install with npm (`npm i -g my-app` or `npx my-app`): auto-update and launcher shortcuts.

No installers, no code signing, no release server — npm is already your release channel, so updating is just `npm i -g my-app@latest`. This package does that for you, from inside the app.

## Install

```sh
npm install electron-npm-installer
```

Requires Electron 30+. ESM-only (from CommonJS, use `await import()`).

## Auto-update

```js
import { checkForUpdate, installUpdate } from 'electron-npm-installer'

const update = await checkForUpdate() // → { name: 'my-app', current: '1.2.0', latest: '1.3.0', mode: 'npm-global' }, or null if up to date
installUpdate()                       // installs that version: closes the app, updates it, opens it again
```

Show a "New version available" button when `checkForUpdate()` returns something, and call `installUpdate()` when it's clicked.

`checkForUpdate()` asks npm once and shares the answer. For an app that stays open for days, ask again now and then:

```js
setInterval(() => checkForUpdate({ fresh: true }).then(showUpdateButton), 6 * 60 * 60_000)
```

No update UI of your own? Let the package ask in a native dialog:

```js
import { promptForUpdate } from 'electron-npm-installer'

app.whenReady().then(() => promptForUpdate()) // "My App 1.3.0 is available" → Update now / Later
```

npx runs aren't asked by default, since they'd see it on every launch. Pass `promptForUpdate({ npx: true })` to offer them a global install.

To see the dialog, run `npm start` from a clone of this package ([example/update-prompt.js](example/update-prompt.js)). The example poses as an old `electron-find-overlay`, so **Update now** really installs that package globally.

Your app's name and `bin` are read from its `package.json`. Keep this package out of your main-process bundle (most Electron bundlers externalize dependencies by default): it starts its `installer.js` from its own folder.

What `checkForUpdate()` returns:

- **Installed with `npm i -g`:** the new version, if there is one.
- **Run with `npx`:** always returns a result, so you can offer a proper global install (npx's copy is temporary).
- **Run from a repo checkout:** always `null`. Pass `checkForUpdate({ dev: true })` to try the flow anyway; it updates your global install and doesn't reopen.

## Shortcuts

```js
import { createShortcuts } from 'electron-npm-installer'

createShortcuts({ appId: 'com.example.my-app', name: 'My App', description: 'What my app does' }) // before the first window
```

On Windows this adds Start Menu and Desktop shortcuts, and on macOS an app in `~/Applications`. Linux is skipped.

- They're created once per install: if the user deletes one, it stays deleted until the next `npm i -g`.
- A repo checkout gets its own `My App (local)` shortcuts, so both stay launchable. Pass `dev: true` while developing to leave the user's shortcuts alone.
- npx runs get none, since npx's copy is temporary.

To remove them, delete `My App*.lnk` from the Start Menu and Desktop, or `~/Applications/My App*.app`.

## Launch mode

```js
import { LAUNCH_MODES, launchMode } from 'electron-npm-installer/launch-mode' // no electron import: plain-node scripts can use it too

launchMode(app.getAppPath()) // → 'npm-global', 'npx-temp' (npx's temporary copy) or 'npm-start' (a repo checkout); 'npm-dev' with { dev: true }
```

## Good to know

- Works with npm only, not pnpm or yarn.
- If an update fails, the old version opens again.

## License

MIT
