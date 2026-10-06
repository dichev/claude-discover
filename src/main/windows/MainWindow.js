import { app, BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import windowStateKeeper from 'electron-window-state'
import contextMenu from 'electron-context-menu'
import { FindOverlay } from 'electron-find-overlay'
import { lockNavigation } from '../utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEV_URL = process.env.ELECTRON_RENDERER_URL

export class MainWindow {
  constructor() {
    this.win = null
  }

  create() {
    nativeTheme.themeSource = 'dark' // the UI is dark-only; keeps the find bar and native menus dark under a light OS theme
    const state = windowStateKeeper({ defaultWidth: 1500, defaultHeight: 900 })
    this.win = new BrowserWindow({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
      backgroundColor: '#0b0d12',
      autoHideMenuBar: true,
      title: `Claude Discover v${app.getVersion()}`,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    state.manage(this.win)
    this.win.on('page-title-updated', e => e.preventDefault())
    lockNavigation(this.win.webContents)

    contextMenu({ window: this.win, showSelectAll: true, showCopyImage: true, showCopyLink: true, showInspectElement: true })
    if (DEV_URL) {
      this.win.loadURL(DEV_URL)
    } else {
      this.win.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    this.findBar = new FindOverlay(this.win)
    // let the app mount all entries while open so findInPage can match off-screen content
    this.findBar.on('show', () => this.send('find:active', true))
    this.findBar.on('hide', () => this.send('find:active', false))
    this.win.on('closed', () => this.findBar = null) // @macOS the menu outlives the window, so its find accelerators must not reach a destroyed one
    return this.win
  }

  send(channel, payload) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }

  focus() { // bring the window forward, e.g. for an incoming deep link
    if (!this.win || this.win.isDestroyed()) return
    if (this.win.isMinimized()) this.win.restore()
    this.win.show()
    this.win.focus()
  }
}
