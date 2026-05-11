import { app } from 'electron'

const CDP_PORT = '9333'

if (app.isPackaged) {
  console.warn('[debug.js] loaded in a packaged build — this should not happen')
}

// Enable remote debugging (for MCP playwright)
if (process.env.ELECTRON_RENDERER_URL) {
  app.commandLine.appendSwitch('remote-debugging-port', CDP_PORT)
}

// Enable React DevTools
app.whenReady().then(async () => {
  const { installExtension, REACT_DEVELOPER_TOOLS } = await import('@tomjs/electron-devtools-installer')
  await installExtension(REACT_DEVELOPER_TOOLS)
})
