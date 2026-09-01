const { contextBridge, ipcRenderer } = require('electron');

// Minimal bridge: open-with-PDF delivery + read/write of that file's bytes.
contextBridge.exposeInMainWorld('electronPdf', {
  /** Subscribe to "the OS asked us to open this .pdf". Returns an unsubscribe fn. */
  onOpen(cb) {
    const handler = (_e, filePath) => cb(filePath);
    ipcRenderer.on('open-pdf', handler);
    ipcRenderer.send('renderer-ready'); // flush a path we may have been launched with
    return () => ipcRenderer.removeListener('open-pdf', handler);
  },
  read: filePath => ipcRenderer.invoke('pdf:read', filePath),
  write: (filePath, data) => ipcRenderer.invoke('pdf:write', filePath, data),
  /** Open a fresh window (its own paper). */
  newWindow: () => ipcRenderer.send('open-new-window'),
});
