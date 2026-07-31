import { app, ipcMain } from 'electron'

const CDP_PORT = '9333'

if (app.isPackaged) {
  console.warn('[debug.js] loaded in a packaged build — this should not happen')
}

// Separate profile, so dev can run alongside the built app (they'd fight over the same disk cache)
app.setPath('userData', app.getPath('userData') + '-dev')

// Enable remote debugging (for MCP playwright)
if (process.env.ELECTRON_RENDERER_URL) {
  app.commandLine.appendSwitch('remote-debugging-port', CDP_PORT)
}

// Startup breakdown, ms since the Electron process started: "main imports" is Electron boot plus
// the main bundle's imports, "window created"→"renderer loaded" is the renderer (in dev, Vite
// serving the module graph), and the rest is the first session scan. The npm/vite/rollup time
// before Electron launches is NOT in these numbers — electron-vite prints its own timings above.
const since = () => Math.round(process.uptime() * 1000) + 'ms'
const took = t => Math.round((process.uptime() - t) * 1000)
const startup = (label, at = since()) => console.info('[startup]', label.padEnd(22), at)
const seen = new Set()
const firstTime = key => !seen.has(key) && !!seen.add(key)

startup('main imports')
app.whenReady().then(() => startup('app ready'))
app.on('browser-window-created', (_e, win) => {
  startup('window created')
  const wc = win.webContents
  wc.once('dom-ready', () => startup('renderer dom-ready'))
  wc.once('did-finish-load', async () => {
    startup('renderer loaded')
    // What the page itself spent: in dev that's Vite serving the module graph one file at a
    // time (hundreds of requests, the cold-start bottleneck); packaged it's a few bundles.
    const t = await wc.executeJavaScript(RENDERER_TIMING).catch(() => null)
    if (t) startup(`renderer modules (${t.count}${t.capped ? '+' : ''})`, `${t.fetch}ms fetching, dom ${t.dcl}ms`)
  })
  // The scan streams sessions to the renderer in batches. Log the first one and the last one before
  // it goes quiet, so a re-scan (the daily pricing refresh drops the meta cache) shows as a late settle.
  const send = wc.send.bind(wc)
  let first = true, lastAt = null, settle = null
  wc.send = (channel, ...args) => {
    if (channel === 'sessions:update') {
      const count = args[0]?.length
      if (first) { first = false; startup(`sessions first (${count})`) }
      lastAt = since()
      clearTimeout(settle)
      settle = setTimeout(() => { // first quiet second ends startup — later batches are live updates
        startup(`sessions settled (${count})`, lastAt)
        wc.send = send
      }, 1000)
      settle.unref()
    }
    return send(channel, ...args)
  }
})

// Chromium's resource buffer holds 250 entries — a bigger module graph reports as "250+".
const RENDERER_TIMING = `(() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const res = performance.getEntriesByType('resource')
  return {
    dcl: Math.round(nav.domContentLoadedEventEnd),
    count: res.length,
    capped: res.length >= 250,
    fetch: Math.round(res.reduce((sum, r) => sum + r.duration, 0)),
  }
})()`

// First call of each sessions channel — 'sessions:list' is the gate: no disk is touched until
// the renderer asks for a period (and App.jsx waits another 120ms after mount before asking).
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, fn) => handle(channel, (...args) => {
  if (channel.startsWith('sessions:') && firstTime(channel)) startup(`ipc ${channel}`)
  return fn(...args)
})

// The scan itself: a cold walk (readdir + stat of every project, then parsing the period's
// transcripts) vs. a warm one served from the StatCache, and when chokidar goes live.
const { SessionsScanner } = await import('./sessions/SessionsScanner.js')
const { scan, watch } = SessionsScanner.prototype
SessionsScanner.prototype.scan = async function (day, opts) {
  const label = this.statCache.complete && this.watcher ? 'scan (cached)' : 'scan (disk walk)'
  const t = process.uptime()
  const result = await scan.call(this, day, opts)
  if (firstTime(label)) startup(`${label} +${took(t)}ms`)
  return result
}
SessionsScanner.prototype.watch = async function (opts) {
  const result = await watch.call(this, opts)
  startup('watcher live')
  return result
}

// Enable React DevTools
app.whenReady().then(async () => {
  const t = process.uptime()
  const { installExtension, REACT_DEVELOPER_TOOLS } = await import('@tomjs/electron-devtools-installer')
  await installExtension(REACT_DEVELOPER_TOOLS)
  startup(`react devtools (+${took(t)}ms)`)
})
