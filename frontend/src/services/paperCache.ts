/**
 * IndexedDB cache for processed papers, keyed by PDF content hash.
 * Lets us skip the (expensive) chunk + embedding pass when the same file is
 * reopened. Also holds a one-time pristine copy of each opened PDF for recovery.
 */

import type { ChatSession, ChunkMetaItem } from '../api';

const DB_NAME = 'paper-explorer-reader';
const DB_VERSION = 2;
const STORE_PAPERS = 'papers';
const STORE_ORIGINALS = 'originals';
const STORE_CHATS = 'chats';

export interface PaperCacheEntry {
  hash: string;
  title: string;
  filename: string;
  doi?: string;
  arxivId?: string;
  chunkMeta: ChunkMetaItem[];
  embeddingsB64: string;
  embeddingDim: number;
  embeddingModel: string;
  createdAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openReaderDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_PAPERS)) {
          db.createObjectStore(STORE_PAPERS, { keyPath: 'hash' });
        }
        if (!db.objectStoreNames.contains(STORE_ORIGINALS)) {
          db.createObjectStore(STORE_ORIGINALS);
        }
        if (!db.objectStoreNames.contains(STORE_CHATS)) {
          db.createObjectStore(STORE_CHATS);
        }
      };
      // Another tab / stale connection is holding an older version open.
      req.onblocked = () => reject(new Error('Database upgrade blocked — close other tabs of this app and reload.'));
      req.onsuccess = () => {
        // Don't hold the upgrade back for the next version bump.
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
    // If it fails, don't cache the rejection forever.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openReaderDB().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function getCachedPaper(hash: string): Promise<PaperCacheEntry | null> {
  return tx<PaperCacheEntry | undefined>(STORE_PAPERS, 'readonly', s => s.get(hash)).then(v => v ?? null);
}

export function putCachedPaper(entry: PaperCacheEntry): Promise<void> {
  return tx(STORE_PAPERS, 'readwrite', s => s.put(entry)).then(() => undefined);
}

export function stashOriginal(hash: string, bytes: ArrayBuffer): Promise<void> {
  return tx(STORE_ORIGINALS, 'readonly', s => s.getKey(hash)).then(existing => {
    if (existing !== undefined) return;
    return tx(STORE_ORIGINALS, 'readwrite', s => s.put(bytes, hash)).then(() => undefined);
  });
}

export function restoreOriginal(hash: string): Promise<ArrayBuffer | null> {
  return tx<ArrayBuffer | undefined>(STORE_ORIGINALS, 'readonly', s => s.get(hash)).then(v => v ?? null);
}

export function getChats(hash: string): Promise<ChatSession[]> {
  return tx<ChatSession[] | undefined>(STORE_CHATS, 'readonly', s => s.get(hash))
    .then(v => v ?? [])
    .catch(() => []);
}

export function saveChats(hash: string, chats: ChatSession[]): Promise<void> {
  return tx(STORE_CHATS, 'readwrite', s => s.put(chats, hash))
    .then(() => undefined)
    .catch(() => undefined);
}
