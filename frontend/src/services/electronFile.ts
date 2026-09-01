/**
 * "Open with… Paper Reader" path: when the Electron shell hands us a file path,
 * wrap it in the same WritableFileHandle shape the File System Access API path
 * uses, so processing and annotation write-back are identical.
 */

import { hashBytes, type OpenedPdf, type WritableFileHandle } from './pdfFile';
import { stashOriginal } from './paperCache';

interface ElectronPdfBridge {
  onOpen: (cb: (filePath: string) => void) => () => void;
  read: (filePath: string) => Promise<Uint8Array>;
  write: (filePath: string, data: ArrayBuffer) => Promise<void>;
  newWindow: () => void;
}

function bridge(): ElectronPdfBridge | null {
  return (window as unknown as { electronPdf?: ElectronPdfBridge }).electronPdf ?? null;
}

/** Open a fresh app window (Electron only; no-op in a browser). */
export function openNewWindow(): void {
  bridge()?.newWindow();
}

/** Copy any byte source into a plain (non-shared) ArrayBuffer. */
function toArrayBuffer(src: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  const out = new ArrayBuffer(src.byteLength);
  const dst = new Uint8Array(out);
  if (src instanceof ArrayBuffer) {
    dst.set(new Uint8Array(src));
  } else {
    dst.set(new Uint8Array(src.buffer as ArrayBuffer, src.byteOffset, src.byteLength));
  }
  return out;
}

export function isElectron(): boolean {
  return bridge() !== null;
}

/** Subscribe to OS "open this PDF" events. No-op outside Electron. */
export function onOpenPdfPath(cb: (filePath: string) => void): () => void {
  return bridge()?.onOpen(cb) ?? (() => {});
}

export async function openPdfFromPath(filePath: string): Promise<OpenedPdf | null> {
  const api = bridge();
  if (!api) return null;

  const bytes = toArrayBuffer(await api.read(filePath));
  const name = filePath.replace(/^.*[/\\]/, '');
  const hash = await hashBytes(bytes);
  await stashOriginal(hash, toArrayBuffer(bytes));

  const handle: WritableFileHandle = {
    name,
    async getFile() {
      return new File([bytes], name, { type: 'application/pdf' });
    },
    async createWritable() {
      return {
        async write(data: BufferSource) {
          await api.write(filePath, toArrayBuffer(data));
        },
        async close() {},
      };
    },
  };

  return { handle, bytes, hash, name };
}
