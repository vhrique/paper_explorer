/* Electron main process. The renderer is plain Chromium running the Vite build,
 * so the app's web APIs (File System Access, IndexedDB) work unchanged. */
const { app, BrowserWindow, Menu, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

// No File/Edit/View menu bar. (macOS keeps a minimal app menu — the OS requires it.)
Menu.setApplicationMenu(null);

let mainWin = null;
let pendingPdf = null; // a .pdf path the OS asked us to open before the UI was ready

function pdfFromArgv(argv) {
  const hit = argv.find(a => !a.startsWith('-') && /\.pdf$/i.test(a));
  return hit ? path.resolve(hit) : null;
}

function deliverPdf(p) {
  if (!p) return;
  pendingPdf = p;
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
    flushPdf(mainWin.webContents);
  }
}

function flushPdf(sender) {
  if (pendingPdf && sender) {
    sender.send('open-pdf', pendingPdf);
    pendingPdf = null;
  }
}

// Single instance: a second launch (e.g. double-clicking another PDF) reuses this window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => deliverPdf(pdfFromArgv(argv)));
}

// macOS "Open with" — can fire before the app is ready.
app.on('open-file', (event, p) => {
  event.preventDefault();
  deliverPdf(p);
});

pendingPdf = pdfFromArgv(process.argv.slice(1));

function createWindow() {
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
  mainWin = win;

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
    } else if (mod && key === 'q') {
      app.quit();
    }
  });

  win.on('closed', () => {
    if (mainWin === win) mainWin = null;
  });

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  // Desktop app: allow the renderer to call any LLM/embedding endpoint the user
  // configures (OpenAI, Anthropic, a local server) without CORS friction.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
      },
    });
  });

  // The renderer reads/writes the opened PDF through these — same bytes the
  // File System Access path uses, so annotation write-back works identically.
  ipcMain.handle('pdf:read', (_e, p) => fs.readFile(p));
  ipcMain.handle('pdf:write', (_e, p, data) => fs.writeFile(p, Buffer.from(data)));
  // Renderer signals it is listening; hand it any path we were launched with.
  ipcMain.on('renderer-ready', e => flushPdf(e.sender));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
