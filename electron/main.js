import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import windowStateKeeper from 'electron-window-state';
import { SessionsService } from './services/SessionsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.ELECTRON_RENDERER_URL;

let mainWindow;
let sessionsService;

if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
  app.commandLine.appendSwitch('remote-debugging-port', '9333')
}


function createWindow() {
  const state = windowStateKeeper({ defaultWidth: 1500, defaultHeight: 900 });

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  state.manage(mainWindow);

  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  sessionsService = new SessionsService({
    onUpdate: (sessions) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sessions:update', sessions);
      }
    }
  });
  sessionsService.start();

  ipcMain.handle('sessions:list', (_e, date) => sessionsService.list(date));
  ipcMain.handle('sessions:read', async (_e, sessionId, offset, date) => sessionsService.readSession(sessionId, offset, date));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
