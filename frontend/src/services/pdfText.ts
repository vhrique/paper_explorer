/**
 * Pull the plain text sitting under a rectangular region of one PDF page.
 * Used when the user drags a region and asks the chat about that specific part.
 */

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import type { Rect } from '../api';

if (!pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.js',
    import.meta.url,
  ).toString();
}

let cache: { bytes: ArrayBuffer; doc: PDFDocumentProxy } | null = null;

async function getDoc(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  if (cache && cache.bytes === bytes) return cache.doc;
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  cache = { bytes, doc };
  return doc;
}

export interface PageGeometry {
  /** presented page width/height at scale 1 (rotation applied) */
  width: number;
  height: number;
  /** normalized (top-left, [0,1]) -> PDF user-space point (bottom-left origin) */
  toPdfPoint(nx: number, ny: number): [number, number];
  /** PDF user-space point -> normalized (top-left, [0,1]) */
  toNorm(px: number, py: number): { x: number; y: number };
}

/**
 * Geometry for one page, via pdf.js's own viewport transform so page rotation
 * and a non-zero MediaBox origin are handled correctly.
 */
export async function getPageGeometry(bytes: ArrayBuffer, page: number): Promise<PageGeometry> {
  const doc = await getDoc(bytes);
  const pg = await doc.getPage(page + 1);
  const vp = pg.getViewport({ scale: 1 });
  return {
    width: vp.width,
    height: vp.height,
    toPdfPoint: (nx, ny) => vp.convertToPdfPoint(nx * vp.width, ny * vp.height) as [number, number],
    toNorm: (px, py) => {
      const [vx, vy] = vp.convertToViewportPoint(px, py);
      return { x: vx / vp.width, y: vy / vp.height };
    },
  };
}

/**
 * @param page 0-based page index
 * @param region normalized rect (top-left origin, values in [0,1])
 */
export async function extractRegionText(bytes: ArrayBuffer, page: number, region: Rect): Promise<string> {
  const doc = await getDoc(bytes);
  if (page < 0 || page >= doc.numPages) return '';
  const pg = await doc.getPage(page + 1);
  const viewport = pg.getViewport({ scale: 1 });
  const pw = viewport.width;
  const ph = viewport.height;

  const rx0 = region.x * pw;
  const ry0 = region.y * ph;
  const rx1 = (region.x + region.width) * pw;
  const ry1 = (region.y + region.height) * ph;

  const content = await pg.getTextContent();
  const hits: { x0: number; y0: number; text: string }[] = [];
  for (const raw of content.items) {
    if (!('str' in raw)) continue;
    const item = raw as TextItem;
    if (!item.str.trim()) continue;
    const [a, b, , d, tx, ty] = item.transform as number[];
    const fontH = item.height || Math.abs(d) || Math.hypot(a, b) || 10;
    const x0 = tx;
    const y0 = ph - ty - fontH;
    const x1 = tx + (item.width || 0);
    const y1 = ph - ty;
    const overlaps = x0 < rx1 && x1 > rx0 && y0 < ry1 && y1 > ry0;
    if (overlaps) hits.push({ x0, y0, text: item.str });
  }

  hits.sort((p, q) => (Math.abs(p.y0 - q.y0) > 4 ? p.y0 - q.y0 : p.x0 - q.x0));
  return hits
    .map(h => h.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
