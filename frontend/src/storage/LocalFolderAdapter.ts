import type { StorageAdapter } from './types';

const IDB_NAME = 'paper-explorer';
const IDB_STORE = 'handles';
const IDB_KEY = 'root-dir';

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => { db.close(); resolve((req.result as FileSystemDirectoryHandle) ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export class LocalFolderAdapter implements StorageAdapter {
  private root: FileSystemDirectoryHandle | null = null;

  async connect(): Promise<void> {
    this.root = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    await saveHandle(this.root!);
  }

  isConnected(): boolean {
    return this.root !== null;
  }

  async tryRestoreFromIDB(): Promise<boolean> {
    try {
      const handle = await loadHandle();
      if (!handle) return false;
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        this.root = handle;
        return true;
      }
    } catch {}
    return false;
  }

  /** Returns the stored folder name without requesting permission (no user gesture needed). */
  async getStoredFolderName(): Promise<string | null> {
    try {
      const handle = await loadHandle();
      if (!handle) return null;
      return handle.name;
    } catch {
      return null;
    }
  }

  private async navigateTo(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    const parts = path.split('/');
    let dir = this.root!;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create });
    }
    return { dir, name: parts[parts.length - 1] };
  }

  async readJSON<T>(path: string): Promise<T | null> {
    try {
      const { dir, name } = await this.navigateTo(path, false);
      const fh = await dir.getFileHandle(name);
      const file = await fh.getFile();
      return JSON.parse(await file.text()) as T;
    } catch {
      return null;
    }
  }

  async writeJSON(path: string, data: unknown): Promise<void> {
    const { dir, name } = await this.navigateTo(path, true);
    const fh = await dir.getFileHandle(name, { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    try {
      const { dir, name } = await this.navigateTo(path, false);
      const fh = await dir.getFileHandle(name);
      return (await fh.getFile()).arrayBuffer();
    } catch {
      return null;
    }
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const { dir, name } = await this.navigateTo(path, true);
    const fh = await dir.getFileHandle(name, { create: true });
    const writable = await fh.createWritable();
    await writable.write(data);
    await writable.close();
  }

  async writeFile(path: string, file: File): Promise<void> {
    const { dir, name } = await this.navigateTo(path, true);
    const fh = await dir.getFileHandle(name, { create: true });
    const writable = await fh.createWritable();
    await writable.write(file);
    await writable.close();
  }

  async getFileBlob(path: string): Promise<Blob | null> {
    try {
      const { dir, name } = await this.navigateTo(path, false);
      const fh = await dir.getFileHandle(name);
      return fh.getFile();
    } catch {
      return null;
    }
  }

  async deleteFile(path: string): Promise<void> {
    try {
      const { dir, name } = await this.navigateTo(path, false);
      await dir.removeEntry(name);
    } catch {}
  }

  async deleteDirectory(path: string): Promise<void> {
    try {
      const parts = path.split('/');
      let dir = this.root!;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
      }
      await dir.removeEntry(parts[parts.length - 1], { recursive: true });
    } catch {}
  }
}
