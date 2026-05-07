import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import windowStateKeeper from 'electron-window-state'
import { SessionsService } from './services/SessionsService.js'
import { refreshPricesFromLiteLLM } from './services/Pricing.js'
import { readWorkHours, writeWorkHours } from './services/WorkHours.js'
import { AgentRunner } from './services/AgentRunner.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEV_URL = process.env.ELECTRON_RENDERER_URL

let mainWindow
let sessionsService
const agentRunner = new AgentRunner()

if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
  app.commandLine.appendSwitch('remote-debugging-port', '9333')
}


function createWindow() {
  const state = windowStateKeeper({ defaultWidth: 1500, defaultHeight: 900 })

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    title: `Agentic Workflow v${app.getVersion()} - Discover`,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  state.manage(mainWindow)
  mainWindow.on('page-title-updated', (e) => e.preventDefault())
  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  if (!app.isPackaged) {
    const {installExtension, REACT_DEVELOPER_TOOLS} = await import('@tomjs/electron-devtools-installer')
    await installExtension(REACT_DEVELOPER_TOOLS)
  }

  refreshPricesFromLiteLLM() // refresh in the background; early reads use the seed table

  sessionsService = new SessionsService({
    onUpdate: (sessions) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sessions:update', sessions)
      }
    }
  })
  sessionsService.start()

  powerMonitor.on('suspend', () => {
    sessionsService.stop()
    powerMonitor.once('resume', () => setTimeout(() => sessionsService.start(), 1000))
  })

  ipcMain.handle('sessions:list', (_e, date) => sessionsService.list(date))
  ipcMain.handle('sessions:read', async (_e, sessionId, offset, date) => sessionsService.readSession(sessionId, offset, date))
  ipcMain.handle('sessions:read-log-file', (_e, filePath) => sessionsService.readLogFile(filePath))
  ipcMain.handle('work-hours:get', () => readWorkHours())
  ipcMain.handle('work-hours:set', (_e, data) => writeWorkHours(data))
  ipcMain.handle('agent:run', (e, text, systemTools) => agentRunner.run(text, e.sender, systemTools))


  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
