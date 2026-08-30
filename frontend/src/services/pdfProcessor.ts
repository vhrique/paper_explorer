import * as pdfjs from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { ProcessResponse, ChunkMetaItem, Rect } from '../api';
import { embedBatch, EmbeddingNotConfiguredError } from './embeddingService';
import { getEmbeddingModelId } from './settingsService';

// Use the worker from the same pdfjs-dist version already loaded by react-pdf.
// Only set if not already configured.
if (!pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.js',
    import.meta.url,
  ).toString();
}

const MIN_BLOCK_CHARS = 40;
const MIN_PARA_CHARS = 30;
const MIN_SENT_CHARS = 20;

const BAD_TITLE_WORDS = new Set(['microsoft', 'word', 'latex', 'adobe', 'untitled', 'document']);

// ---- Text splitting (ported from Python) ----

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map(p => p.trim())
    .filter(p => p.length >= MIN_PARA_CHARS);
}

function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ');
  return normalized
    .split(/(?<=[.!?])\s+(?=[A-Z\d("])/)
    .map(s => s.trim())
    .filter(s => s.length >= MIN_SENT_CHARS);
}

// ---- Word sequence rect matching (ported from Python _find_rect_in_sequence) ----

interface WordEntry {
  text: string;
  charStart: number;
  charEnd: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function buildWordSequence(words: Array<{ text: string; x0: number; y0: number; x1: number; y1: number }>): { fullText: string; entries: WordEntry[] } {
  let fullText = '';
  const entries: WordEntry[] = [];
  for (const w of words) {
    if (fullText) fullText += ' ';
    const charStart = fullText.length;
    fullText += w.text;
    entries.push({ text: w.text, charStart, charEnd: fullText.length, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 });
  }
  return { fullText, entries };
}

function findRectsInSequence(
  text: string,
  fullSeq: string,
  entries: WordEntry[],
  pw: number,
  ph: number,
  startPos: number,
): { rects: Rect[]; endPos: number } {
  const norm = text.replace(/\s+/g, ' ').trim();
  const idx = fullSeq.indexOf(norm, startPos);
  if (idx === -1) return { rects: [], endPos: startPos };

  const tEnd = idx + norm.length;
  const matching = entries.filter(e => e.charStart < tEnd && e.charEnd > idx);
  if (!matching.length) return { rects: [], endPos: startPos };

  // Group matching words into per-line rects to avoid spanning columns.
  matching.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lineGroups: WordEntry[][] = [[matching[0]]];
  for (let i = 1; i < matching.length; i++) {
    const prev = matching[i - 1];
    const curr = matching[i];
    const h = Math.max(curr.y1 - curr.y0, prev.y1 - prev.y0);
    if (Math.abs(curr.y0 - prev.y0) > h * 0.5) {
      lineGroups.push([curr]);
    } else {
      lineGroups[lineGroups.length - 1].push(curr);
    }
  }

  const rects = lineGroups.map(group => {
    const x0 = Math.min(...group.map(e => e.x0));
    const y0 = Math.min(...group.map(e => e.y0));
    const x1 = Math.max(...group.map(e => e.x1));
    const y1 = Math.max(...group.map(e => e.y1));
    return { x: x0 / pw, y: y0 / ph, width: (x1 - x0) / pw, height: (y1 - y0) / ph };
  });

  return { rects, endPos: tEnd };
}

function blockToLineRects(block: RawBlock, pw: number, ph: number): Rect[] {
  return block.lines.map(line => {
    const ws = line.words;
    const x0 = Math.min(...ws.map(w => w.x0));
    const y0 = Math.min(...ws.map(w => w.y0));
    const x1 = Math.max(...ws.map(w => w.x1));
    const y1 = Math.max(...ws.map(w => w.y1));
    return { x: x0 / pw, y: y0 / ph, width: (x1 - x0) / pw, height: (y1 - y0) / ph };
  });
}

// ---- pdfjs text extraction ----

interface RawWord {
  text: string;
  x0: number; y0: number; x1: number; y1: number;
}

interface RawLine {
  words: RawWord[];
  y: number;
  height: number;
}

interface RawBlock {
  lines: RawLine[];
  text: string;
  x0: number; y0: number; x1: number; y1: number;
}

function extractPageBlocks(
  items: TextItem[],
  pageHeight: number,
): RawBlock[] {
  if (!items.length) return [];

  // pdfjs returns TextItems in PDF content-stream order. For well-formed
  // academic PDFs (LaTeX) this is reading order: column 1 top→bottom, then
  // column 2 top→bottom. We trust this order and detect block/line boundaries
  // purely from y-position changes — no column detection needed.
  const words: RawWord[] = items
    .filter(item => item.str.trim())
    .map(item => {
      const [a, b, , d, tx, ty] = item.transform as number[];
      const fontH = item.height || Math.abs(d) || Math.sqrt(a * a + b * b) || 10;
      return {
        text: item.str.trimEnd(),
        x0: tx,
        y0: pageHeight - ty - fontH,
        x1: tx + (item.width || 0),
        y1: pageHeight - ty,
      };
    })
    .filter(w => w.text.trim());

  if (!words.length) return [];

  // Group words into lines (same line = tops within half a line height).
  const rawLines: RawLine[] = [];
  let lineWords: RawWord[] = [words[0]];
  let lineY = words[0].y0;
  let lineH = words[0].y1 - words[0].y0;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (Math.abs(w.y0 - lineY) <= Math.max(lineH * 0.5, 2)) {
      lineWords.push(w);
      lineH = Math.max(lineH, w.y1 - w.y0);
    } else {
      rawLines.push({ words: lineWords, y: lineY, height: lineH });
      lineWords = [w];
      lineY = w.y0;
      lineH = w.y1 - w.y0;
    }
  }
  rawLines.push({ words: lineWords, y: lineY, height: lineH });

  // Page-level typography stats: median line advance and line height. These are
  // far more stable than per-block estimates for deciding paragraph breaks.
  const advList: number[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const a = rawLines[i].y - rawLines[i - 1].y;
    if (a > 0 && a < rawLines[i].height * 4) advList.push(a);
  }
  advList.sort((a, b) => a - b);
  const pageAdv = advList.length ? advList[advList.length >> 1] : 0;
  const heights = rawLines.map(l => l.height).sort((a, b) => a - b);
  const pageFont = heights.length ? heights[heights.length >> 1] : 10;

  // Segment lines into blocks. A block boundary is a strong signal only:
  // y jumps backward (new column) or a gap much larger than normal leading
  // (section / figure break). Ordinary paragraph breaks stay inside the block
  // and are marked in makeBlock.
  const blocks: RawBlock[] = [];
  let blockLines: RawLine[] = [rawLines[0]];
  for (let i = 1; i < rawLines.length; i++) {
    const adv = rawLines[i].y - rawLines[i - 1].y;
    if (adv < 0 || (pageAdv > 0 && adv > pageAdv * 2.2)) {
      blocks.push(makeBlock(blockLines, pageAdv, pageFont));
      blockLines = [];
    }
    blockLines.push(rawLines[i]);
  }
  if (blockLines.length) blocks.push(makeBlock(blockLines, pageAdv, pageFont));

  return blocks.filter(b => b.text.length >= MIN_BLOCK_CHARS);
}

function makeBlock(lines: RawLine[], pageAdv: number, pageFont: number): RawBlock {
  const allWords = lines.flatMap(l => l.words);
  const x0 = Math.min(...allWords.map(w => w.x0));
  const y0 = Math.min(...allWords.map(w => w.y0));
  const x1 = Math.max(...allWords.map(w => w.x1));
  const y1 = Math.max(...allWords.map(w => w.y1));

  const lineIndent = (i: number) => Math.min(...lines[i].words.map(w => w.x0)) - x0;

  // Words on a line joined by space; lines joined by "\n", with a blank line
  // ("\n\n", a paragraph break) before a line whose vertical gap widens, or that
  // is indented while the next line returns to the margin (a true first-line
  // indent — not a hanging indent, which keeps every continuation line indented).
  let text = lines.length ? lines[0].words.map(w => w.text).join(' ') : '';
  for (let i = 1; i < lines.length; i++) {
    const lineText = lines[i].words.map(w => w.text).join(' ');
    const adv = lines[i].y - lines[i - 1].y;
    const indent = lineIndent(i);
    const nextIndent = i + 1 < lines.length ? lineIndent(i + 1) : 0;
    const firstLineIndent = indent > pageFont * 0.6 && nextIndent < pageFont * 0.6;
    const paragraphBreak = (pageAdv > 0 && adv > pageAdv * 1.4) || firstLineIndent;
    text += (paragraphBreak ? '\n\n' : '\n') + lineText;
  }

  return { lines, text, x0, y0, x1, y1 };
}

// ---- Title / DOI / arXiv extraction ----

function extractTitle(items: TextItem[], metaTitle: string): string | null {
  if (metaTitle && metaTitle.length > 5 && metaTitle.length < 500) {
    const lower = metaTitle.toLowerCase();
    if (![...BAD_TITLE_WORDS].some(w => lower.includes(w))) return metaTitle;
  }

  // Largest font-scale item on first page
  let bestText = '';
  let bestScale = 0;
  for (const item of items) {
    const str = (item.str || '').trim();
    if (!str || str.length < 5 || str.length > 300) continue;
    const scale = Math.abs((item.transform as number[])[0] ?? 0);
    if (scale > bestScale) { bestScale = scale; bestText = str; }
  }
  return bestText || null;
}

function extractDoi(text: string): string | null {
  const match = text.match(/\b10\.\d{4,}\/\S+/i);
  if (!match) return null;
  return match[0].replace(/[.),;\]]+$/, '');
}

function extractArxivId(text: string): string | null {
  const match = text.match(
    /(?:arXiv:|arxiv\.org\/abs\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i,
  );
  if (!match) return null;
  return match[1].replace(/v\d+$/, '');
}

// ---- Base64 encoding (chunked to avoid call stack overflow) ----

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let result = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    result += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(result);
}

// ---- Embedding (can run separately / in the background) ----

export interface EmbedResult {
  b64: string;
  dim: number;
  model: string;
}

/** Embed a list of chunk texts into a flat Float32 blob (base64). Empty result on failure. */
export async function embedChunkTexts(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<EmbedResult> {
  try {
    const vectors = await embedBatch(texts, onProgress);
    if (!vectors.length) return { b64: '', dim: 0, model: '' };
    const dim = vectors[0].length;
    const flat = new Float32Array(vectors.length * dim);
    for (let i = 0; i < vectors.length; i++) flat.set(vectors[i], i * dim);
    return { b64: arrayBufferToBase64(flat.buffer), dim, model: getEmbeddingModelId() };
  } catch (e) {
    if (!(e instanceof EmbeddingNotConfiguredError)) {
      console.warn('Embedding failed, keeping chunks without embeddings:', e);
    }
    return { b64: '', dim: 0, model: '' };
  }
}

// ---- Main export ----

export async function processPaperClientSide(
  file: File,
  onProgress?: (stage: string) => void,
  opts: { embed?: boolean } = {},
): Promise<ProcessResponse> {
  onProgress?.('Parsing PDF…');

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer.slice(0) });
  const pdf = await loadingTask.promise;

  const metaInfo = await pdf.getMetadata().catch(() => ({ info: {} }));
  const metaTitle = ((metaInfo.info as Record<string, string>)?.Title ?? '').trim();

  const allChunkMeta: ChunkMetaItem[] = [];
  let chunkIdx = 0;
  let firstPageText = '';
  let firstPageItems: TextItem[] = [];

  for (let pageNum = 0; pageNum < pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum + 1);
    const viewport = page.getViewport({ scale: 1.0 });
    const pw = viewport.width;
    const ph = viewport.height;

    const content = await page.getTextContent();
    const items = content.items.filter((item): item is TextItem => 'str' in item);

    if (pageNum === 0) {
      firstPageItems = items;
      firstPageText = items.map(i => i.str).join(' ');
    }

    const blocks = extractPageBlocks(items, ph);

    for (const block of blocks) {
      const blockWords = block.lines.flatMap(l => l.words);
      const { fullText: blockSeq, entries: blockEntries } = buildWordSequence(blockWords);

      const blockLineRects = blockToLineRects(block, pw, ph);

      const blockIdx = chunkIdx++;
      allChunkMeta.push({
        idx: blockIdx,
        text: block.text,
        page: pageNum,
        granularity: 'block',
        parent_idx: -1,
        rects: blockLineRects,
      });

      const paraTexts = splitIntoParagraphs(block.text);
      const parasToProcess = paraTexts.length ? paraTexts : [block.text];
      let paraSearchPos = 0;

      for (const paraText of parasToProcess) {
        if (paraText.length < MIN_PARA_CHARS) continue;

        const { rects: paraRects, endPos: paraEnd } = findRectsInSequence(
          paraText, blockSeq, blockEntries, pw, ph, paraSearchPos,
        );
        const resolvedParaRects = paraRects.length ? paraRects : blockLineRects;
        if (paraRects.length) paraSearchPos = paraEnd;

        const paraIdx = chunkIdx++;
        allChunkMeta.push({
          idx: paraIdx,
          text: paraText,
          page: pageNum,
          granularity: 'paragraph',
          parent_idx: blockIdx,
          rects: resolvedParaRects,
        });

        // Narrow words to paragraph y-range for sentence matching
        const paraY0 = Math.min(...resolvedParaRects.map(r => r.y)) * ph - 2;
        const paraY1 = Math.max(...resolvedParaRects.map(r => r.y + r.height)) * ph + 2;
        const paraWords = blockWords.filter(w => w.y0 >= paraY0 && w.y1 <= paraY1 + 2);
        const { fullText: paraSeq, entries: paraEntries } = buildWordSequence(
          paraWords.length ? paraWords : blockWords,
        );

        const normPara = paraText.replace(/\s+/g, ' ').trim();
        const sentences = splitIntoSentences(normPara);
        let sentSearchPos = 0;

        for (const sentText of sentences) {
          if (sentText.length < MIN_SENT_CHARS) continue;

          const { rects: sentRects, endPos: sentEnd } = findRectsInSequence(
            sentText, paraSeq, paraEntries, pw, ph, sentSearchPos,
          );
          if (sentRects.length) sentSearchPos = sentEnd;

          allChunkMeta.push({
            idx: chunkIdx++,
            text: sentText,
            page: pageNum,
            granularity: 'sentence',
            parent_idx: paraIdx,
            rects: sentRects.length ? sentRects : resolvedParaRects,
          });
        }
      }
    }
  }

  // Extract title / DOI / arXiv from first page
  const title = extractTitle(firstPageItems, metaTitle) ?? file.name.replace(/\.pdf$/i, '');
  const doi = extractDoi(firstPageText) ?? undefined;
  const arxivId = extractArxivId(firstPageText) ?? undefined;

  let embedded: EmbedResult = { b64: '', dim: 0, model: '' };
  if (opts.embed !== false) {
    onProgress?.('Generating embeddings…');
    embedded = await embedChunkTexts(allChunkMeta.map(c => c.text));
  }

  return {
    metadata: { title, filename: file.name, doi, arxiv_id: arxivId },
    embeddings_bin_b64: embedded.b64,
    chunk_meta: allChunkMeta,
    embedding_dim: embedded.dim,
    embedding_model: embedded.dim > 0 ? embedded.model : '',
  };
}
