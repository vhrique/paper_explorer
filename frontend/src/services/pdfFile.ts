/**
 * Opening and saving the single PDF the reader works on.
 *
 * The picked file IS the source of truth for annotations: we read its bytes,
 * hand them to pdf-lib for annotation edits, and write the new bytes straight
 * back to the same file on disk (debounced, atomic via createWritable).
 */

import { stashOriginal } from './paperCache';

type PermDescriptor = { mode: 'read' | 'readwrite' };

/**
 * Structural type for a File System Access file handle — declared locally
 * because `showOpenFilePicker` and the permission methods aren't in the DOM lib.
 */
export interface WritableFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BufferSource): Promise<void>; close(): Promise<void> }>;
  queryPermission?(d: PermDescriptor): Promise<PermissionState>;
  requestPermission?(d: PermDescriptor): Promise<PermissionState>;
}

type OpenFilePicker = (opts?: unknown) => Promise<WritableFileHandle[]>;

function picker(): OpenFilePicker | undefined {
  return (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
}

export interface OpenedPdf {
  handle: WritableFileHandle;
  bytes: ArrayBuffer;
  hash: string;
  name: string;
}

const PICKER_OPTS = {
  types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
  multiple: false,
  excludeAcceptAllOption: false,
};

export function isFilePickerSupported(): boolean {
  return typeof picker() === 'function';
}

export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Prompt for a PDF. Returns null if the user cancels. */
export async function pickPdf(): Promise<OpenedPdf | null> {
  const show = picker();
  if (!show) return null;

  let handle: WritableFileHandle;
  try {
    [handle] = await show(PICKER_OPTS);
  } catch {
    return null; // user dismissed the picker
  }

  try {
    await handle.requestPermission?.({ mode: 'readwrite' });
  } catch {
    /* fall through — writes will use the download fallback */
  }

  const file = await handle.getFile();
  const bytes = await file.arrayBuffer();
  const hash = await hashBytes(bytes);
  await stashOriginal(hash, bytes.slice(0));
  return { handle, bytes, hash, name: file.name };
}

async function canWrite(handle: WritableFileHandle): Promise<boolean> {
  try {
    const q = handle.queryPermission ? await handle.queryPermission({ mode: 'readwrite' }) : 'granted';
    if (q === 'granted') return true;
    const r = handle.requestPermission ? await handle.requestPermission({ mode: 'readwrite' }) : 'denied';
    return r === 'granted';
  } catch {
    return false;
  }
}

async function writeNow(handle: WritableFileHandle, bytes: ArrayBuffer): Promise<void> {
  if (await canWrite(handle)) {
    const w = await handle.createWritable();
    await w.write(bytes);
    await w.close();
    return;
  }
  downloadFallback(await handle.getFile().then(f => f.name).catch(() => 'annotated.pdf'), bytes);
}

export function downloadFallback(name: string, bytes: ArrayBuffer): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Debounced write-back ----

const DEBOUNCE_MS = 1500;
let pending: { handle: WritableFileHandle; bytes: ArrayBuffer } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushWrites(), DEBOUNCE_MS);
}

/** Queue a write of `bytes` to `handle`; coalesces rapid calls. */
export function writeBack(handle: WritableFileHandle, bytes: ArrayBuffer): void {
  pending = { handle, bytes };
  schedule();
}

/** Force any queued write to disk now. */
export async function flushWrites(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const job = pending;
  pending = null;
  if (!job) return inFlight;
  inFlight = inFlight.then(() => writeNow(job.handle, job.bytes)).catch(err => {
    console.error('PDF write-back failed:', err);
  });
  return inFlight;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushWrites();
  });
  window.addEventListener('beforeunload', () => {
    if (pending) void flushWrites();
  });
}
