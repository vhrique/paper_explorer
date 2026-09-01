/* Electron main process. The renderer is plain Chromium running the Vite build,
 * so the app's web APIs (File System Access, IndexedDB) work unchanged.
 *
 * One window per PDF: opening another PDF (via "Open with" or the in-app
 * "open another" button) spawns a new window rather than replacing the current
 * paper. IndexedDB (cache + chats) is shared across windows. */
const { app, BrowserWindow, Menu, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

Menu.setApplicationMenu(null);

const windows = new Set();
const pendingByWc = new Map(); // webContents.id -> pdf path to hand that window
let initialPdf = null; // a path from the very first launch, before app is ready

function pdfFromArgv(argv) {
  const hit = argv.find(a => !a.startsWith('-') && /\.pdf$/i.test(a));
  return hit ? path.resolve(hit) : null;
}

function flushPdf(sender) {
  const p = pendingByWc.get(sender.id);
  if (p) {
    pendingByWc.delete(sender.id);
    sender.send('open-pdf', p);
  }
}

function focusLast() {
  const win = [...windows].pop();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  return win;
}

function createWindow(pdfPath) {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f3f4f6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  windows.add(win);
  if (pdfPath) pendingByWc.set(win.webContents.id, pdfPath);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Keep the shortcuts the removed menu would have provided.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const mod = input.control || input.meta;
    if (key === 'f5' || (mod && key === 'r')) {
      win.webContents.reload();
      event.preventDefault();
    } else if (key === 'f12' || (mod && input.shift && key === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    } else if (mod && key === 'n') {
      createWindow(null);
      event.preventDefault();
    } else if (mod && key === 'w') {
      win.close();
      event.preventDefault();
    } else if (mod && key === 'q') {
      app.quit();
    }
  });

  win.on('closed', () => {
    windows.delete(win);
    pendingByWc.delete(win.webContents.id);
  });

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  return win;
}

/** A PDF path arrived from the OS. New window if we're up, else buffer it. */
function openPdf(p) {
  if (!p) return;
  if (app.isReady() && windows.size) createWindow(p);
  else initialPdf = p;
}

// Single instance: all launches funnel through this process so we own the windows.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const p = pdfFromArgv(argv);
    if (p) createWindow(p);
    else focusLast() || createWindow(null);
  });
}

// macOS "Open with" — can fire before the app is ready.
app.on('open-file', (event, p) => {
  event.preventDefault();
  openPdf(p);
});

initialPdf = pdfFromArgv(process.argv.slice(1));

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Access-Control-Allow-Origin': ['*'] } });
  });

  // The renderer reads/writes its PDF through these — same bytes the File System
  // Access path uses, so annotation write-back is identical.
  ipcMain.handle('pdf:read', (_e, p) => fs.readFile(p));
  ipcMain.handle('pdf:write', (_e, p, data) => fs.writeFile(p, Buffer.from(data)));
  ipcMain.on('renderer-ready', e => flushPdf(e.sender));
  ipcMain.on('open-new-window', () => createWindow(null));

  createWindow(initialPdf);
  initialPdf = null;

  app.on('activate', () => {
    if (windows.size === 0) createWindow(null);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
