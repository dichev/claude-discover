import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import windowStateKeeper from 'electron-window-state'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEV_URL = process.env.ELECTRON_RENDERER_URL

export class MainWindow {
  constructor() {
    this.win = null
  }

  create() {
    const state = windowStateKeeper({ defaultWidth: 1500, defaultHeight: 900 })

    this.win = new BrowserWindow({
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

    state.manage(this.win)
    this.win.on('page-title-updated', e => e.preventDefault())
    if (DEV_URL) {
      this.win.loadURL(DEV_URL)
    } else {
      this.win.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    return this.win
  }

  send(channel, payload) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }
}
