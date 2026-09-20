import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { SessionsService } from './services/SessionsService.js'
import { WorkHours } from './services/WorkHours.js'
import { AgentRunner } from './services/AgentRunner.js'
import { Switchers } from './services/switchers/Switchers.js'
import { MainWindow } from './windows/MainWindow.js'
import { CLAUDE_DIR, RECENT_CLAUDE_DIRS } from './paths.js'
import { openLinkSafely } from './utils.js'

export class Application {
  constructor({ deepLink }) {
    this.deepLink        = deepLink
    this.win             = new MainWindow()
    this.agentRunner     = new AgentRunner()
    this.workHours       = new WorkHours()
    this.sessionsService = new SessionsService()
    this.switchers       = new Switchers({ restart: () => this.restart() }) // the on/off features behind the StatusBar switches
  }

  start() {
    const { deepLink, win, agentRunner, workHours, sessionsService, switchers } = this

    Menu.setApplicationMenu(this.#buildMenu())

    // main → renderer
    sessionsService.on('update', sessions => win.send('sessions:update', sessions))
    sessionsService.on('progress', p => win.send('sessions:scan-progress', p))
    deepLink.on('open', target => {
      win.focus()
      win.send('deeplink:open-session', target)
    })

    // renderer → main
    ipcMain.handle('sessions:list', (_e, date, granularity) => sessionsService.list(date, granularity))
    ipcMain.handle('sessions:read', (_e, filePath, date, granularity) => sessionsService.readSession(filePath, date, granularity))
    ipcMain.handle('sessions:read-requests', (_e, filePath, date, granularity) => sessionsService.readRequests(filePath, date, granularity))
    ipcMain.handle('switch:status', (_e, name) => switchers.status(name))
    ipcMain.handle('switch:activate', (_e, name) => switchers.activate(name))
    ipcMain.handle('switch:deactivate', (_e, name) => switchers.deactivate(name))
    ipcMain.handle('switch:keep-active', (_e, name, value) => switchers.setKeepActive(name, value))
    ipcMain.handle('work-hours:get', () => workHours.read())
    ipcMain.handle('work-hours:set', (_e, data) => workHours.write(data))
    ipcMain.handle('agent:run', (e, text, systemTools, cache) => agentRunner.run(text, e.sender, systemTools, cache))
    ipcMain.handle('shell:open-link', (_e, href, baseFile) => openLinkSafely(href, baseFile))
    ipcMain.handle('deeplink:take-pending', () => deepLink.takePending())
    ipcMain.on('find:query', (_e, text, options) => win.findBar?.query(text, options))
    ipcMain.on('find:stop', () => win.findBar?.stop())
    ipcMain.on('find:close', () => win.findBar?.hide())
    ipcMain.on('claude-settings:get', e => e.returnValue = { claudeDir: CLAUDE_DIR })

    // app lifecycle
    app.on('activate', () => { // @macOS
      if (BrowserWindow.getAllWindows().length === 0) win.create()
    })
    app.on('window-all-closed', () => { // @macOS
      if (process.platform !== 'darwin') app.quit()
    })
    // Switches not marked "keep active when the app is closed" are undone on quit, so their
    // settings.json config dies with the app (deactivate is async — hold the quit)
    app.on('will-quit', async e => {
      e.preventDefault()
      await switchers.deactivateOnQuit()
      app.exit()
    })

    // Finish wiring before starting services or loading the renderer.
    sessionsService.start()
    win.create()
  }

  // app.exit skips will-quit, so switches stay active across the restart
  restart() {
    if (import.meta.env.DEV) { // electron-vite dev tears down its Vite server when Electron exits, so a relaunched window would have no renderer to load
      dialog.showMessageBoxSync({ type: 'info', message: 'Restart required', detail: 'Stop and re-run `npm run dev` to apply the change.' })
    } else {
      app.relaunch()
    }
    BrowserWindow.getAllWindows().forEach(w => w.close())
    app.exit(0)
  }

  #buildMenu() {
    const { win, switchers } = this
    const changeDir = dir => switchers.activate('claudedir', dir)
    return Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []), // @macOS
      {
        label: 'File',
        submenu: [
          { label: 'Change directory…', click: () => changeDir() },
          { type: 'separator' },
          ...RECENT_CLAUDE_DIRS.map(p => ({
            label: p, type: 'checkbox', checked: p === CLAUDE_DIR, click: () => changeDir(p),
          })),
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { // @macOS Cmd+C/V/A have no key equivalents without an Edit menu; Windows/Linux get these from Chromium
        label: 'Edit',
        submenu: [
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => win.findBar?.show() },
          { label: 'Deselect', accelerator: 'Escape', click: (_i, w) => win.findBar?.visible ? win.findBar.hide() : w?.webContents.unselect() },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
        ],
      },
    ])
  }
}
