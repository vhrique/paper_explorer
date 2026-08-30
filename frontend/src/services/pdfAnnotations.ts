/**
 * Read / write the PDF's own annotation objects with pdf-lib.
 *
 * The file is the single source of truth: highlights are `/Highlight`, sticky
 * notes are `/Text`, region boxes are `/Square`. Every annotation carries a
 * `/NM` (our stable id) so we can find it again to edit or delete.
 *
 * Geometry goes through pdf.js's viewport transform (see pdfText.getPageGeometry)
 * so page rotation and MediaBox offsets are handled.
 */

import { PDFDocument, PDFName, PDFString, PDFHexString, PDFNumber, PDFArray, PDFDict } from 'pdf-lib';
import type { Annotation, AnnotationKind, Rect } from '../api';
import { getPageGeometry } from './pdfText';

const AUTHOR = 'Reader';
const HIGHLIGHT_OPACITY = 0.4;
const NOTE_SIZE_PT = 18;

function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 0.83, 0.28];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgb01ToHex(rgb: number[]): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${c(rgb[0] ?? 1)}${c(rgb[1] ?? 0.83)}${c(rgb[2] ?? 0.28)}`;
}

function pdfDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function decodeStr(v: unknown): string {
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  return '';
}

/** PDFName -> bare string (no leading slash). */
function nameOf(v: unknown): string {
  return v instanceof PDFName ? v.asString().replace(/^\//, '') : '';
}

function num(v: unknown): number {
  return v instanceof PDFNumber ? v.asNumber() : 0;
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

async function load(bytes: ArrayBuffer): Promise<PDFDocument> {
  return PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
}

function getOrCreateAnnots(doc: PDFDocument, pageIndex: number): PDFArray {
  const node = doc.getPage(pageIndex).node;
  let annots = node.Annots();
  if (!annots) {
    annots = doc.context.obj([]) as PDFArray;
    node.set(PDFName.of('Annots'), annots);
  }
  return annots;
}

// ---- Reading ----

export async function readAnnotations(bytes: ArrayBuffer): Promise<Annotation[]> {
  const doc = await load(bytes);
  const out: Annotation[] = [];
  const pages = doc.getPages();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const annots = pages[pageIndex].node.Annots();
    if (!annots) continue;

    let geom: Awaited<ReturnType<typeof getPageGeometry>> | null = null;

    for (let i = 0; i < annots.size(); i++) {
      const resolved = annots.lookup(i);
      if (!(resolved instanceof PDFDict)) continue;
      const dict = resolved;

      const st = nameOf(dict.lookup(PDFName.of('Subtype')));
      let kind: AnnotationKind | null = null;
      if (st === 'Highlight') kind = 'highlight';
      else if (st === 'Text') kind = 'note';
      else if (st === 'Square') kind = 'region';
      if (!kind) continue;

      const nm = decodeStr(dict.lookup(PDFName.of('NM')));
      if (!nm) continue; // only manage annotations we created

      if (!geom) geom = await getPageGeometry(bytes, pageIndex);

      const rects: Rect[] = [];
      const quad = dict.lookup(PDFName.of('QuadPoints'));
      if (kind === 'highlight' && quad instanceof PDFArray) {
        const nums: number[] = [];
        for (let q = 0; q < quad.size(); q++) nums.push(num(quad.lookup(q)));
        for (let q = 0; q + 7 < nums.length; q += 8) {
          rects.push(quadToNorm(nums.slice(q, q + 8), geom));
        }
      } else {
        const rectArr = dict.lookup(PDFName.of('Rect'));
        if (rectArr instanceof PDFArray) {
          const r = [0, 1, 2, 3].map(k => num(rectArr.lookup(k)));
          rects.push(pdfRectToNorm(r, geom));
        }
      }
      if (!rects.length) continue;

      const cArr = dict.lookup(PDFName.of('C'));
      const color =
        cArr instanceof PDFArray && cArr.size() >= 3
          ? rgb01ToHex([0, 1, 2].map(k => num(cArr.lookup(k))))
          : '#FDE047';

      out.push({
        id: nm,
        kind,
        page: pageIndex,
        rects,
        color,
        comment: decodeStr(dict.lookup(PDFName.of('Contents'))),
        updatedAt: decodeStr(dict.lookup(PDFName.of('M'))) || new Date().toISOString(),
      });
    }
  }
  return out;
}

function quadToNorm(q: number[], geom: Awaited<ReturnType<typeof getPageGeometry>>): Rect {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const a = geom.toNorm(Math.min(...xs), Math.max(...ys));
  const b = geom.toNorm(Math.max(...xs), Math.min(...ys));
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function pdfRectToNorm(r: number[], geom: Awaited<ReturnType<typeof getPageGeometry>>): Rect {
  const a = geom.toNorm(Math.min(r[0], r[2]), Math.max(r[1], r[3]));
  const b = geom.toNorm(Math.max(r[0], r[2]), Math.min(r[1], r[3]));
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

// ---- Writing ----

/** normalized rect -> PDF-space [x0,y0,x1,y1] (bottom-left origin) */
function normRectToPdf(rect: Rect, geom: Awaited<ReturnType<typeof getPageGeometry>>): [number, number, number, number] {
  const corners = [
    geom.toPdfPoint(rect.x, rect.y),
    geom.toPdfPoint(rect.x + rect.width, rect.y),
    geom.toPdfPoint(rect.x, rect.y + rect.height),
    geom.toPdfPoint(rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = corners.map(c => c[0]);
  const ys = corners.map(c => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function baseFields(id: string, color: string, comment: string) {
  return {
    Type: 'Annot',
    NM: PDFString.of(id),
    T: PDFString.of(AUTHOR),
    Contents: PDFString.of(comment ?? ''),
    M: PDFString.of(pdfDate()),
    F: 4,
    C: hexToRgb01(color),
  };
}

export interface AddHighlightInput {
  id: string;
  page: number;
  rects: Rect[];
  color: string;
  comment?: string;
}

export async function addHighlight(bytes: ArrayBuffer, input: AddHighlightInput): Promise<ArrayBuffer> {
  const doc = await load(bytes);
  const geom = await getPageGeometry(bytes, input.page);

  const quadPoints: number[] = [];
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const rect of input.rects) {
    const [x0, y0, x1, y1] = normRectToPdf(rect, geom);
    quadPoints.push(x0, y1, x1, y1, x0, y0, x1, y0);
    bx0 = Math.min(bx0, x0);
    by0 = Math.min(by0, y0);
    bx1 = Math.max(bx1, x1);
    by1 = Math.max(by1, y1);
  }

  const dict = doc.context.obj({
    ...baseFields(input.id, input.color, input.comment ?? ''),
    Subtype: 'Highlight',
    Rect: [bx0, by0, bx1, by1],
    QuadPoints: quadPoints,
    CA: HIGHLIGHT_OPACITY,
  });
  getOrCreateAnnots(doc, input.page).push(doc.context.register(dict));
  return toBuffer(await doc.save());
}

export interface AddBoxInput {
  id: string;
  page: number;
  rect: Rect;
  color: string;
  comment?: string;
}

export async function addRegion(bytes: ArrayBuffer, input: AddBoxInput): Promise<ArrayBuffer> {
  const doc = await load(bytes);
  const geom = await getPageGeometry(bytes, input.page);
  const [x0, y0, x1, y1] = normRectToPdf(input.rect, geom);

  const dict = doc.context.obj({
    ...baseFields(input.id, input.color, input.comment ?? ''),
    Subtype: 'Square',
    Rect: [x0, y0, x1, y1],
    BS: { W: 1.5, S: 'S' },
    CA: 1,
  });
  getOrCreateAnnots(doc, input.page).push(doc.context.register(dict));
  return toBuffer(await doc.save());
}

export async function addNote(bytes: ArrayBuffer, input: AddBoxInput): Promise<ArrayBuffer> {
  const doc = await load(bytes);
  const geom = await getPageGeometry(bytes, input.page);
  // anchor at the top-left of the drawn/clicked rect
  const [ax, ay] = geom.toPdfPoint(input.rect.x, input.rect.y);

  const dict = doc.context.obj({
    ...baseFields(input.id, input.color, input.comment ?? ''),
    Subtype: 'Text',
    Rect: [ax, ay - NOTE_SIZE_PT, ax + NOTE_SIZE_PT, ay],
    Name: 'Comment',
    Open: false,
  });
  getOrCreateAnnots(doc, input.page).push(doc.context.register(dict));
  return toBuffer(await doc.save());
}

function findAnnot(
  doc: PDFDocument,
  id: string,
): { annots: PDFArray; index: number; dict: PDFDict } | null {
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const resolved = annots.lookup(i);
      if (!(resolved instanceof PDFDict)) continue;
      if (decodeStr(resolved.lookup(PDFName.of('NM'))) === id) return { annots, index: i, dict: resolved };
    }
  }
  return null;
}

export async function updateComment(bytes: ArrayBuffer, id: string, comment: string): Promise<ArrayBuffer> {
  const doc = await load(bytes);
  const found = findAnnot(doc, id);
  if (found) {
    found.dict.set(PDFName.of('Contents'), PDFString.of(comment));
    found.dict.set(PDFName.of('M'), PDFString.of(pdfDate()));
  }
  return toBuffer(await doc.save());
}

export async function deleteAnnotation(bytes: ArrayBuffer, id: string): Promise<ArrayBuffer> {
  const doc = await load(bytes);
  const found = findAnnot(doc, id);
  if (found) found.annots.remove(found.index);
  return toBuffer(await doc.save());
}
