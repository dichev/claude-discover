import { app, BrowserWindow, ipcMain, powerMonitor, shell } from 'electron'
import path from 'node:path'
import { SessionsService } from './services/SessionsService.js'
import { WorkHours } from './services/WorkHours.js'
import { AgentRunner } from './services/AgentRunner.js'
import { MainWindow } from './windows/MainWindow.js'
import { CLAUDE_DIR, HOOK_PATH } from './paths.js'
import { ClaudeSettings } from './services/ClaudeSettings.js'

if (import.meta.env.DEV) await import('./debug.js')


app.whenReady().then(() => {
  const win             = new MainWindow()
  const agentRunner     = new AgentRunner()
  const workHours       = new WorkHours()
  const sessionsService = new SessionsService()

  sessionsService.on('update', sessions => win.send('sessions:update', sessions))
  sessionsService.on('progress', p => win.send('sessions:scan-progress', p))
  sessionsService.start()
  powerMonitor.on('suspend', () => {
    sessionsService.stop()
    powerMonitor.once('resume', () => setTimeout(() => sessionsService.start(), 1000))
  })
  const settings = new ClaudeSettings()
  const hookInstalled = settings.hooks('InstructionsLoaded').some(h => h.command?.includes(HOOK_PATH))

  win.create()
  app.on('activate', () => { // @macOS
    if (BrowserWindow.getAllWindows().length === 0) win.create()
  })


  ipcMain.handle('sessions:list', (_e, date, granularity) => sessionsService.list(date, granularity))
  ipcMain.handle('sessions:read', (_e, sessionId, offset, date, granularity) => sessionsService.readSession(sessionId, offset, date, granularity))

  ipcMain.handle('work-hours:get', () => workHours.read())
  ipcMain.handle('work-hours:set', (_e, data) => workHours.write(data))

  ipcMain.handle('agent:run', (e, text, systemTools) => agentRunner.run(text, e.sender, systemTools))

  ipcMain.handle('shell:open-link', (_e, href, baseFile) => openLink(href, baseFile))

  ipcMain.on('find:query', (_e, text, options) => win.findBar?.query(text, options))
  ipcMain.on('find:stop',  () => win.findBar?.stop())
  ipcMain.on('find:close', () => win.findBar?.hide())

  ipcMain.on('claude-dir:get',       e => { e.returnValue = CLAUDE_DIR })
  ipcMain.on('hook:installed:get',   e => { e.returnValue = hookInstalled })
  ipcMain.on('cleanup-period:get',   e => { e.returnValue = settings.cleanupPeriodDays ?? null })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

async function openLink(href, baseFile) {
  if (/^(https?:|mailto:)/i.test(href)) return shell.openExternal(href)
  const abs = path.resolve(path.dirname(baseFile), decodeURIComponent(href))
  const err = await shell.openPath(abs) // returns '' on success, error string otherwise
  if (err) shell.showItemInFolder(abs)  // no associated app (or missing) -> reveal it instead
  return err
}
