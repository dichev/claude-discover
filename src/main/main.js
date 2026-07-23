import { app, BrowserWindow, ipcMain } from 'electron'
import { SessionsService } from './services/SessionsService.js'
import { WorkHours } from './services/WorkHours.js'
import { AgentRunner } from './services/AgentRunner.js'
import { MainWindow } from './windows/MainWindow.js'
import { CLAUDE_DIR } from './paths.js'
import { Switchers } from './services/switchers/Switchers.js'
import { openLinkSafely } from './utils.js'

if (import.meta.env.DEV) await import('./debug.js')


app.whenReady().then(() => {
  const win             = new MainWindow()
  const agentRunner     = new AgentRunner()
  const workHours       = new WorkHours()
  const sessionsService = new SessionsService()

  sessionsService.on('update', sessions => win.send('sessions:update', sessions))
  sessionsService.on('progress', p => win.send('sessions:scan-progress', p))
  sessionsService.start()

  win.create()
  app.on('activate', () => { // @macOS
    if (BrowserWindow.getAllWindows().length === 0) win.create()
  })


  ipcMain.handle('sessions:list', (_e, date, granularity) => sessionsService.list(date, granularity))
  ipcMain.handle('sessions:read', (_e, sessionId, date, granularity) => sessionsService.readSession(sessionId, date, granularity))
  ipcMain.handle('sessions:read-requests', (_e, sessionId, date, granularity) => sessionsService.readRequests(sessionId, date, granularity))

  ipcMain.handle('work-hours:get', () => workHours.read())
  ipcMain.handle('work-hours:set', (_e, data) => workHours.write(data))

  ipcMain.handle('agent:run', (e, text, systemTools, cache) => agentRunner.run(text, e.sender, systemTools, cache))

  ipcMain.handle('shell:open-link', (_e, href, baseFile) => openLinkSafely(href, baseFile))

  ipcMain.on('find:query', (_e, text, options) => win.findBar?.query(text, options))
  ipcMain.on('find:stop',  () => win.findBar?.stop())
  ipcMain.on('find:close', () => win.findBar?.hide())

  ipcMain.on('claude-settings:get', e => e.returnValue = { claudeDir: CLAUDE_DIR })

  const switchers = new Switchers() // the on/off features behind the StatusBar switches
  // Switches not marked "keep active when the app is closed" are undone on quit, so their
  // settings.json config dies with the app (deactivate is async — hold the quit)
  app.on('will-quit', async e => {
    e.preventDefault()
    await switchers.deactivateOnQuit()
    app.exit()
  })
  ipcMain.handle('switch:status',      (_e, name) => switchers.status(name))
  ipcMain.handle('switch:activate',    (_e, name) => switchers.activate(name))
  ipcMain.handle('switch:deactivate',  (_e, name) => switchers.deactivate(name))
  ipcMain.handle('switch:keep-active', (_e, name, value) => switchers.setKeepActive(name, value))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
