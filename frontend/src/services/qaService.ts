/**
 * Single-paper retrieval + answering for the assisted reader.
 *
 * Retrieval is paragraph-level so answers can point the user at concrete
 * locations in the PDF. Dense cosine when the paper's cached embeddings match
 * the configured model; BM25 (MiniSearch) otherwise.
 */

import MiniSearch from 'minisearch';
import type { ChunkResult, QuoteContext, Rect } from '../api';
import type { PaperCacheEntry } from './paperCache';
import { embedText } from './embeddingService';
import { getEmbeddingModelId, getLlmContextTokens, getQaRequireSources, hasLLMConfig } from './settingsService';
import { chat, type ChatTurn } from './llmService';

export type QaTurn = { role: 'user' | 'assistant'; content: string };

export interface PaperChunks {
  texts: string[];
  pages: number[];
  granularities: string[];
  parentIndices: number[];
  rects: Rect[][];
  embeddings: Float32Array;
  embDim: number;
  embeddingModel: string;
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function chunksFromCache(entry: PaperCacheEntry): PaperChunks {
  const buf = entry.embeddingsB64 ? b64ToArrayBuffer(entry.embeddingsB64) : null;
  return {
    texts: entry.chunkMeta.map(c => c.text),
    pages: entry.chunkMeta.map(c => c.page),
    granularities: entry.chunkMeta.map(c => c.granularity),
    parentIndices: entry.chunkMeta.map(c => c.parent_idx),
    rects: entry.chunkMeta.map(c => (c.rects.length ? c.rects : [{ x: 0, y: 0, width: 0, height: 0 }])),
    embeddings: buf && entry.embeddingDim > 0 ? new Float32Array(buf) : new Float32Array(0),
    embDim: entry.embeddingDim,
    embeddingModel: entry.embeddingModel ?? '',
  };
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}

let bm25: { chunks: PaperChunks; index: MiniSearch } | null = null;

function bm25Index(chunks: PaperChunks): MiniSearch {
  if (bm25 && bm25.chunks === chunks) return bm25.index;
  const index = new MiniSearch<{ id: number; text: string }>({ fields: ['text'], storeFields: ['id'] });
  const docs = chunks.texts
    .map((text, i) => ({ id: i, text }))
    .filter(d => chunks.granularities[d.id] === 'paragraph');
  index.addAll(docs);
  bm25 = { chunks, index };
  return index;
}

function toResult(chunks: PaperChunks, idx: number, similarity: number): ChunkResult {
  return {
    chunk_id: idx,
    page: chunks.pages[idx],
    text: chunks.texts[idx],
    similarity,
    rects: chunks.rects[idx],
  };
}

export async function retrieve(query: string, chunks: PaperChunks, k = 5): Promise<ChunkResult[]> {
  const paragraphIdx = chunks.granularities
    .map((g, i) => (g === 'paragraph' ? i : -1))
    .filter(i => i >= 0);
  if (!paragraphIdx.length) return [];

  const modelMatches = chunks.embDim > 0 && chunks.embeddingModel === getEmbeddingModelId();
  if (modelMatches) {
    try {
      const q = new Float32Array(await embedText(query));
      const scored = paragraphIdx
        .map(i => ({ i, s: cosine(q, chunks.embeddings.subarray(i * chunks.embDim, (i + 1) * chunks.embDim)) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, k);
      return scored.map(({ i, s }) => toResult(chunks, i, s));
    } catch {
      /* fall through to BM25 */
    }
  }

  const results = bm25Index(chunks).search(query, { boost: { text: 1 }, fuzzy: 0.2 }).slice(0, k);
  if (!results.length) return [];
  const max = results[0].score || 1;
  return results.map(r => toResult(chunks, r.id as number, r.score / max));
}

export interface AnswerParams {
  question: string;
  paperTitle: string;
  chunks: PaperChunks;
  history?: QaTurn[];
  quote?: QuoteContext | null;
  signal?: AbortSignal;
}

export interface AnswerResult {
  answer: string | null;
  locations: ChunkResult[];
  /** true when `locations` are the passages the model itself cited. */
  cited: boolean;
  /** note shown when the model cited nothing usable or cited almost everything. */
  citedNote?: string;
  /** How many passages of the paper were put in the prompt. */
  passagesSent: number;
  /** Total paragraph count in the paper. */
  passagesTotal: number;
  /** 'full' = whole paper sent; 'window' = the passages that fit the context;
   *  'region' = a slice centred on the passages the selected text/region overlaps. */
  mode: 'full' | 'window' | 'region';
  /** Estimated tokens: the whole paper's passages, the configured window, and the
   *  passage budget after prompt/answer headroom. */
  paperTokens: number;
  contextTokens: number;
  budgetTokens: number;
}

const estTok = (chars: number) => Math.ceil(chars / 4);
const jsonRow = (p: { id: number; page: number; text: string }) => JSON.stringify(p).length;

function allParagraphs(chunks: PaperChunks): ChunkResult[] {
  const out: ChunkResult[] = [];
  for (let i = 0; i < chunks.texts.length; i++) {
    if (chunks.granularities[i] !== 'paragraph') continue;
    out.push(toResult(chunks, i, 0));
  }
  return out;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Indices into `pool` of passages the quoted text/region sits on. */
function anchorIndices(pool: { n: number; result: ChunkResult }[], quote: QuoteContext): number[] {
  const hits: number[] = [];
  pool.forEach((p, i) => {
    if (p.result.page !== quote.page) return;
    if (p.result.rects.some(pr => quote.rects.some(qr => rectsOverlap(pr, qr)))) hits.push(i);
  });
  if (hits.length) return hits;
  // Geometry missed — match on the quoted text.
  const needle = quote.text.trim().slice(0, 60).toLowerCase();
  if (needle.length >= 12) {
    pool.forEach((p, i) => {
      if (p.result.text.toLowerCase().includes(needle)) hits.push(i);
    });
  }
  return hits;
}

/** A contiguous slice of `pool` centred on [lo..hi], padded and trimmed to `budgetTok`.
 *  The anchor span [lo..hi] is always kept; only the padding is trimmed. */
function windowAround(
  pool: { n: number; result: ChunkResult }[],
  lo: number,
  hi: number,
  pad: number,
  budgetTok: number,
): { n: number; result: ChunkResult }[] {
  let a = Math.max(0, lo - pad);
  let b = Math.min(pool.length - 1, hi + pad);
  const cost = (i: number) =>
    estTok(jsonRow({ id: pool[i].n, page: pool[i].result.page + 1, text: pool[i].result.text }));
  let used = 0;
  for (let i = a; i <= b; i++) used += cost(i);
  while (used > budgetTok && (a < lo || b > hi)) {
    // Drop from whichever side still has padding and is farther from the anchor.
    if (b > hi && (a >= lo || b - hi >= lo - a)) {
      used -= cost(b);
      b--;
    } else {
      used -= cost(a);
      a++;
    }
  }
  return pool.slice(a, b + 1);
}

const SYSTEM_JSON =
  'You are given passages from one research paper as a JSON array, each `{"id", "page", "text"}`, ' +
  'in reading order (ids may be non-contiguous). Answer the question using only these passages.\n\n' +
  'Respond with ONE JSON object and nothing else — no prose, no markdown, no code fences:\n' +
  '{"answer": "<concise answer, or a statement that the passages do not address the question>", ' +
  '"sources": [<id>, <id>, ...]}\n\n' +
  'Rules:\n' +
  '- "answer" must be a non-empty string.\n' +
  '- "sources" must be an array of AT MOST 5 passage ids you actually used, most relevant first.\n' +
  '- If the passages do not answer the question, still give "answer" explaining that, and set "sources": [].\n' +
  '- Never omit the "sources" key.';

const SYSTEM_ANSWER_ONLY =
  'You are given passages from one research paper as a JSON array, each `{"id", "page", "text"}`. ' +
  'Answer the question using only these passages. Be concise and specific; if they do not address ' +
  'the question, say so.\n\n' +
  'Respond with ONE JSON object and nothing else: {"answer": "<your answer>"}. ' +
  '"answer" must be a non-empty string.';

const RETRY_MSG =
  'Your previous reply was not a single valid JSON object with a non-empty string "answer" and an ' +
  'array "sources". Reply again with ONLY that JSON object and nothing else.';

/** Best-effort answer text when sources are not required (accepts JSON or plain prose). */
function parseAnswerOnly(raw: string): string {
  const body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const o = JSON.parse(body) as Record<string, unknown>;
    if (o && typeof o.answer === 'string' && o.answer.trim()) return o.answer.trim();
  } catch {
    const m = body.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        /* fall through */
      }
    }
  }
  return body;
}

interface ParsedAnswer {
  answer: string;
  sources: number[];
  valid: boolean;
}

/** Tolerant extraction of {"answer","sources"} from a model reply. */
function parseAnswerJson(raw: string): ParsedAnswer {
  const invalid = (answer = ''): ParsedAnswer => ({ answer, sources: [], valid: false });
  if (!raw || !raw.trim()) return invalid();

  const body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let obj: unknown;
  try {
    obj = JSON.parse(body);
  } catch {
    const s = body.indexOf('{');
    const e = body.lastIndexOf('}');
    if (s === -1 || e <= s) return invalid(body);
    try {
      obj = JSON.parse(body.slice(s, e + 1));
    } catch {
      return invalid(body);
    }
  }
  if (!obj || typeof obj !== 'object') return invalid(body);
  const rec = obj as Record<string, unknown>;

  const answer = typeof rec.answer === 'string' ? rec.answer.trim() : '';
  const hasSources = 'sources' in rec && Array.isArray(rec.sources);
  const sources = hasSources
    ? [...new Set((rec.sources as unknown[]).map(v => Number(v)).filter(n => Number.isInteger(n) && n > 0))]
    : [];

  return { answer, sources, valid: answer !== '' && hasSources };
}

/** Pick as many paragraphs as fit `budgetTok`, by relevance, then restore reading order. */
async function selectWithinBudget(
  pool: { n: number; result: ChunkResult }[],
  searchText: string,
  chunks: PaperChunks,
  budgetTok: number,
): Promise<{ n: number; result: ChunkResult }[]> {
  const ranked = await retrieve(searchText, chunks, pool.length); // all paragraphs, most-relevant first
  const nByChunkId = new Map(pool.map(p => [p.result.chunk_id, p.n]));
  const chosen = new Set<number>();
  let used = 0;
  for (const r of ranked) {
    const n = nByChunkId.get(r.chunk_id);
    if (n == null) continue;
    const cost = estTok(jsonRow({ id: n, page: r.page + 1, text: r.text }));
    if (used + cost > budgetTok) break;
    chosen.add(n);
    used += cost;
  }
  // Guarantee at least something.
  if (!chosen.size && pool.length) chosen.add(pool[0].n);
  return pool.filter(p => chosen.has(p.n));
}

export async function answer(params: AnswerParams): Promise<AnswerResult> {
  const { question, paperTitle, chunks, history, quote, signal } = params;
  const quoteText = quote?.text?.trim() ?? '';
  const searchText = quoteText ? `${quoteText} ${question}` : question;

  const pool = allParagraphs(chunks).map((result, i) => ({ n: i + 1, result }));

  const ctxTok = getLlmContextTokens();
  const reserveTok = estTok(question.length + quoteText.length) + 1400; // system + question + answer headroom
  const budgetTok = Math.max(1500, ctxTok - reserveTok);
  const allTok = pool.reduce((s, p) => s + estTok(jsonRow({ id: p.n, page: p.result.page + 1, text: p.result.text })), 0);

  let selected = pool;
  let mode: 'full' | 'window' | 'region' = 'full';
  let anchorNums: number[] = [];

  const anchors = quote ? anchorIndices(pool, quote) : [];
  if (anchors.length) {
    // The user asked about a specific selection — send a slice centred on it.
    mode = 'region';
    selected = windowAround(pool, Math.min(...anchors), Math.max(...anchors), 4, budgetTok);
    const anchorSet = new Set(anchors.map(i => pool[i].n));
    anchorNums = selected.filter(p => anchorSet.has(p.n)).map(p => p.n);
  } else if (allTok > budgetTok) {
    mode = 'window';
    selected = await selectWithinBudget(pool, searchText, chunks, budgetTok);
  }

  const sentTok = selected.reduce(
    (s, p) => s + estTok(jsonRow({ id: p.n, page: p.result.page + 1, text: p.result.text })),
    0,
  );
  console.info(
    `[qa] paper: ${pool.length} passages ≈ ${allTok} tok | budget ${budgetTok} tok | ` +
      `${mode}: sending ${selected.length} passages ≈ ${sentTok} tok` +
      (anchorNums.length ? ` | anchors: ${anchorNums.join(', ')}` : ''),
  );

  const passagesJson = JSON.stringify(
    selected.map(p => ({ id: p.n, page: p.result.page + 1, text: p.result.text })),
  );

  const requireSources = getQaRequireSources();
  const hasSelection = !!quoteText;

  const userParts: string[] = [];

  if (hasSelection) {
    const kind = quote!.kind === 'region' ? 'region' : 'text';
    userParts.push(
      `=== THE USER'S QUESTION IS ABOUT THIS SELECTION ===\n` +
        `Selected ${kind} on page ${quote!.page + 1}:\n"""\n${quoteText}\n"""\n` +
        (mode === 'region' && anchorNums.length ? `(this appears in passage(s) [${anchorNums.join(', ')}])\n` : '') +
        `Answer strictly about this selection. The other passages are provided only so you can ` +
        `explain or contextualise it — do not shift the focus to unrelated parts of the paper.\n` +
        `=== END SELECTION ===`,
    );
  }

  userParts.push(`Paper: "${paperTitle}"`);
  userParts.push(
    mode === 'region'
      ? `Passages (JSON — ${selected.length} passages around the selection, in reading order):\n${passagesJson}`
      : mode === 'window'
        ? `Passages (JSON — the ${selected.length} most relevant of ${pool.length}, in reading order):\n${passagesJson}`
        : `Passages (JSON — the full paper, ${pool.length} passages):\n${passagesJson}`,
  );
  userParts.push(
    hasSelection ? `Question (about the selection above): ${question}` : `Question: ${question}`,
  );

  const messages: ChatTurn[] = [
    { role: 'system', content: requireSources ? SYSTEM_JSON : SYSTEM_ANSWER_ONLY },
    ...(history ?? []).map(t => ({ role: t.role, content: t.content }) as ChatTurn),
    { role: 'user', content: userParts.join('\n\n') },
  ];

  const base = {
    passagesSent: selected.length,
    passagesTotal: pool.length,
    mode,
    paperTokens: allTok,
    contextTokens: ctxTok,
    budgetTokens: budgetTok,
  };

  const anchorSet = new Set(anchorNums);
  const anchorResults = selected.filter(p => anchorSet.has(p.n)).map(p => p.result);
  const noResponse = (): AnswerResult => ({
    answer: hasLLMConfig() ? 'The LLM endpoint returned no response (check the Network tab).' : null,
    locations: [],
    cited: false,
    ...base,
  });

  // ---- Answer-only mode: no sources contract, no retry ----
  if (!requireSources) {
    const raw = await chat(messages, { json: true, signal });
    if (raw == null) return noResponse();
    return {
      answer: parseAnswerOnly(raw) || '(the model returned an empty answer)',
      locations: anchorResults, // known selection passages, if any — otherwise nothing
      cited: false,
      ...base,
    };
  }

  // ---- Sources mode: {answer, sources} + one retry if the contract is not honoured ----
  let raw = await chat(messages, { json: true, signal });
  let parsed = raw == null ? null : parseAnswerJson(raw);

  if (raw != null && parsed && !parsed.valid) {
    console.info('[qa] first reply was not valid {answer,sources} JSON — retrying');
    raw = await chat(
      [...messages, { role: 'assistant', content: raw }, { role: 'user', content: RETRY_MSG }],
      { json: true, signal },
    );
    parsed = raw == null ? null : parseAnswerJson(raw);
  }

  if (raw == null) return noResponse();

  const p = parsed ?? parseAnswerJson(raw);
  const byN = new Map(pool.map(x => [x.n, x.result]));
  let cited = p.sources.map(n => byN.get(n)).filter((r): r is ChunkResult => !!r);

  const MAX_CITED = 5;
  let citedNote: string | undefined;
  if (!p.valid) {
    citedNote = 'The model did not return the required {answer, sources} format, so sources are unavailable.';
    cited = [];
  } else if (!cited.length) {
    citedNote = 'The model reported no relevant passages.';
  } else if (cited.length > MAX_CITED) {
    citedNote = `The model cited ${cited.length} passages; showing the ${MAX_CITED} most relevant.`;
    cited = cited.slice(0, MAX_CITED);
  }

  return {
    answer: (p.answer || raw.trim() || '(the model returned an empty answer)').trim(),
    locations: cited, // only the model's own citations, in its order
    cited: cited.length > 0,
    citedNote,
    ...base,
  };
}
