import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { SessionsService } from './services/SessionsService.js'
import { WorkHours } from './services/WorkHours.js'
import { AgentRunner } from './services/AgentRunner.js'
import { MainWindow } from './window.js'
import { CLAUDE_DIR } from './paths.js'

if (import.meta.env.DEV) await import('./debug.js')


app.whenReady().then(() => {
  const win             = new MainWindow()
  const agentRunner     = new AgentRunner()
  const workHours       = new WorkHours()
  const sessionsService = new SessionsService()

  sessionsService.on('update', sessions => win.send('sessions:update', sessions))
  agentRunner.on('usage', u => win.send('agent:usage-update', u))
  sessionsService.start()
  agentRunner.startUsagePolling()
  powerMonitor.on('suspend', () => {
    sessionsService.stop()
    powerMonitor.once('resume', () => setTimeout(() => sessionsService.start(), 1000))
  })

  win.create()
  app.on('activate', () => { // @macOS
    if (BrowserWindow.getAllWindows().length === 0) win.create()
  })

  ipcMain.handle('sessions:list', (_e, date) => sessionsService.list(date))
  ipcMain.handle('sessions:read', (_e, sessionId, offset, date) => sessionsService.readSession(sessionId, offset, date))

  ipcMain.handle('work-hours:get', () => workHours.read())
  ipcMain.handle('work-hours:set', (_e, data) => workHours.write(data))

  ipcMain.handle('agent:run',   (e, text, systemTools) => agentRunner.run(text, e.sender, systemTools))
  ipcMain.handle('agent:usage', () => agentRunner.latestUsage)

  ipcMain.on('claude-dir:get', e => { e.returnValue = CLAUDE_DIR })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
