import { WebContentsView } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lockNavigation } from '../utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEV_URL = process.env.ELECTRON_RENDERER_URL

const WIDTH = 320, HEIGHT = 56, MARGIN = 6

// A small overlay view (own web contents) for the find bar, layered over the main window.
// Keeping its input out of the searched page means findInPage never matches the box itself
// and the box's focus never disturbs the search anchor.
export class FindBar {
  constructor(win) {
    this.win = win
    this.view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../preload/findPreload.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    this.view.setBackgroundColor('#00000000') // transparent; the bar draws its own rounded box
    lockNavigation(this.view.webContents)
    win.contentView.addChildView(this.view)
    this.view.setVisible(false)

    if (DEV_URL) this.view.webContents.loadURL(`${DEV_URL}/find/find.html`)
    else this.view.webContents.loadFile(path.join(__dirname, '../renderer/find/find.html'))

    // results come from the MAIN content's find — forward them to the find bar view
    win.webContents.on('found-in-page', (_e, r) => {
      return this.view.webContents.send('find:result', { active: r.activeMatchOrdinal, total: r.matches, id: r.requestId })
    })
    win.on('resize', () => { if (this.visible) this.layout() })
  }

  get visible() { return this.view.getVisible() }

  layout() {
    const [w] = this.win.getContentSize()
    this.view.setBounds({ x: Math.max(0, w - WIDTH - MARGIN), y: MARGIN, width: WIDTH, height: HEIGHT })
  }

  query(text, options) { this.win.webContents.findInPage(text, options) }
  stop() { this.win.webContents.stopFindInPage('clearSelection') }

  show() {
    this.layout()
    this.view.setVisible(true)
    this.view.webContents.focus()
    this.view.webContents.send('find:open')
    this.win.webContents.send('find:active', true) // let the app mount all entries so findInPage can match off-screen content
  }

  hide() {
    if (!this.visible) return
    this.view.setVisible(false)
    this.stop()
    this.win.webContents.focus()
    this.win.webContents.send('find:active', false)
  }
}
