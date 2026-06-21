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

function findRectInSequence(
  text: string,
  fullSeq: string,
  entries: WordEntry[],
  pw: number,
  ph: number,
  startPos: number,
): { rect: Rect | null; endPos: number } {
  const norm = text.replace(/\s+/g, ' ').trim();
  const idx = fullSeq.indexOf(norm, startPos);
  if (idx === -1) return { rect: null, endPos: startPos };

  const tEnd = idx + norm.length;
  const matching = entries.filter(e => e.charStart < tEnd && e.charEnd > idx);
  if (!matching.length) return { rect: null, endPos: startPos };

  const x0 = Math.min(...matching.map(e => e.x0));
  const y0 = Math.min(...matching.map(e => e.y0));
  const x1 = Math.max(...matching.map(e => e.x1));
  const y1 = Math.max(...matching.map(e => e.y1));

  return {
    rect: { x: x0 / pw, y: y0 / ph, width: (x1 - x0) / pw, height: (y1 - y0) / ph },
    endPos: tEnd,
  };
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
  pageWidth: number,
  pageHeight: number,
): RawBlock[] {
  if (!items.length) return [];

  // pdfjs uses bottom-left origin; convert to top-left
  const words: RawWord[] = items
    .filter(item => item.str.trim())
    .map(item => {
      const [, , , , tx, ty] = item.transform as number[];
      const x0 = tx;
      const y0 = pageHeight - ty - (item.height || 0);
      return {
        text: item.str.trimEnd(),
        x0,
        y0,
        x1: x0 + (item.width || 0),
        y1: y0 + (item.height || 0),
      };
    })
    .filter(w => w.text.trim());

  if (!words.length) return [];

  // Group words into lines by Y proximity
  words.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  const lines: RawLine[] = [];
  let currentLine: RawWord[] = [words[0]];
  let lineY = words[0].y0;
  let lineH = words[0].y1 - words[0].y0;

  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const threshold = Math.max(lineH * 0.5, 2);
    if (Math.abs(w.y0 - lineY) <= threshold) {
      currentLine.push(w);
      lineH = Math.max(lineH, w.y1 - w.y0);
    } else {
      lines.push({ words: currentLine, y: lineY, height: lineH });
      currentLine = [w];
      lineY = w.y0;
      lineH = w.y1 - w.y0;
    }
  }
  lines.push({ words: currentLine, y: lineY, height: lineH });

  // Group lines into blocks by vertical gap
  const blocks: RawBlock[] = [];
  let blockLines: RawLine[] = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    const gap = curr.y - (prev.y + prev.height);
    if (gap > prev.height * 1.2) {
      blocks.push(makeBlock(blockLines, pageWidth, pageHeight));
      blockLines = [curr];
    } else {
      blockLines.push(curr);
    }
  }
  blocks.push(makeBlock(blockLines, pageWidth, pageHeight));

  return blocks.filter(b => b.text.length >= MIN_BLOCK_CHARS);
}

function makeBlock(lines: RawLine[], _pw: number, _ph: number): RawBlock {
  const allWords = lines.flatMap(l => l.words);
  const x0 = Math.min(...allWords.map(w => w.x0));
  const y0 = Math.min(...allWords.map(w => w.y0));
  const x1 = Math.max(...allWords.map(w => w.x1));
  const y1 = Math.max(...allWords.map(w => w.y1));

  // Build text: words on same line joined by space, lines joined by newline
  const lineTexts = lines.map(l => l.words.map(w => w.text).join(' '));
  const text = lineTexts.join('\n');

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

// ---- Main export ----

export async function processPaperClientSide(
  file: File,
  onProgress?: (stage: string) => void,
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

    const blocks = extractPageBlocks(items, pw, ph);

    for (const block of blocks) {
      const blockWords = block.lines.flatMap(l => l.words);
      const { fullText: blockSeq, entries: blockEntries } = buildWordSequence(blockWords);

      const blockRect: Rect = {
        x: block.x0 / pw,
        y: block.y0 / ph,
        width: (block.x1 - block.x0) / pw,
        height: (block.y1 - block.y0) / ph,
      };

      const blockIdx = chunkIdx++;
      allChunkMeta.push({
        idx: blockIdx,
        text: block.text,
        page: pageNum,
        granularity: 'block',
        parent_idx: -1,
        rects: [blockRect],
      });

      const paraTexts = splitIntoParagraphs(block.text);
      const parasToProcess = paraTexts.length ? paraTexts : [block.text];
      let paraSearchPos = 0;

      for (const paraText of parasToProcess) {
        if (paraText.length < MIN_PARA_CHARS) continue;

        const { rect: paraRect, endPos: paraEnd } = findRectInSequence(
          paraText, blockSeq, blockEntries, pw, ph, paraSearchPos,
        );
        const resolvedParaRect = paraRect ?? blockRect;
        if (paraRect) paraSearchPos = paraEnd;

        const paraIdx = chunkIdx++;
        allChunkMeta.push({
          idx: paraIdx,
          text: paraText,
          page: pageNum,
          granularity: 'paragraph',
          parent_idx: blockIdx,
          rects: [resolvedParaRect],
        });

        // Narrow words to paragraph y-range for sentence matching
        const py0 = resolvedParaRect.y * ph - 2;
        const py1 = (resolvedParaRect.y + resolvedParaRect.height) * ph + 2;
        const paraWords = blockWords.filter(w => w.y0 >= py0 && w.y1 <= py1 + 2);
        const { fullText: paraSeq, entries: paraEntries } = buildWordSequence(
          paraWords.length ? paraWords : blockWords,
        );

        const normPara = paraText.replace(/\s+/g, ' ').trim();
        const sentences = splitIntoSentences(normPara);
        let sentSearchPos = 0;

        for (const sentText of sentences) {
          if (sentText.length < MIN_SENT_CHARS) continue;

          const { rect: sentRect, endPos: sentEnd } = findRectInSequence(
            sentText, paraSeq, paraEntries, pw, ph, sentSearchPos,
          );
          if (sentRect) sentSearchPos = sentEnd;

          allChunkMeta.push({
            idx: chunkIdx++,
            text: sentText,
            page: pageNum,
            granularity: 'sentence',
            parent_idx: paraIdx,
            rects: [sentRect ?? resolvedParaRect],
          });
        }
      }
    }
  }

  // Extract title / DOI / arXiv from first page
  const title = extractTitle(firstPageItems, metaTitle) ?? file.name.replace(/\.pdf$/i, '');
  const doi = extractDoi(firstPageText) ?? undefined;
  const arxivId = extractArxivId(firstPageText) ?? undefined;

  // Embed all chunks
  onProgress?.('Generating embeddings…');

  let embeddingsBinB64 = '';
  let embeddingDim = 0;

  const allTexts = allChunkMeta.map(c => c.text);

  try {
    const allEmbeddings = await embedBatch(allTexts);
    if (allEmbeddings.length) {
      embeddingDim = allEmbeddings[0].length;
      const flat = new Float32Array(allEmbeddings.length * embeddingDim);
      for (let i = 0; i < allEmbeddings.length; i++) {
        flat.set(allEmbeddings[i], i * embeddingDim);
      }
      embeddingsBinB64 = arrayBufferToBase64(flat.buffer);
    }
  } catch (e) {
    if (!(e instanceof EmbeddingNotConfiguredError)) {
      console.warn('Embedding failed, storing chunks without embeddings:', e);
    }
  }

  return {
    metadata: { title, filename: file.name, doi, arxiv_id: arxivId },
    embeddings_bin_b64: embeddingsBinB64,
    chunk_meta: allChunkMeta,
    embedding_dim: embeddingDim,
    embedding_model: embeddingDim > 0 ? getEmbeddingModelId() : '',
  };
}
