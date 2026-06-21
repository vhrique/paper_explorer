/**
 * Client-side similarity search.
 * Chunk and passage embeddings are loaded from local storage and cached in memory.
 * Falls back to BM25 (via minisearch) for papers without embeddings or with a
 * different embedding model than currently configured.
 */

import MiniSearch from 'minisearch';
import type { SimilarPassage, Passage } from '../api';
import * as workspace from '../storage/workspace';
import { getEmbeddingModelId } from '../services/settingsService';
import {
  loadModel, clearModel, projectQuery, projectKey, getProjectedKeys, dotSim,
} from '../services/similarityModel';

export interface PaperChunkData {
  paperId: number;
  paperTitle: string;
  texts: string[];
  pages: number[];
  granularities: string[];
  parentIndices: number[];
  rects: Array<{ x: number; y: number; width: number; height: number }>;
  embeddings: Float32Array;
  embDim: number;
  embeddingModel: string;  // '' when no embeddings
}

const chunkCache = new Map<number, PaperChunkData>();
const passageEmbCache = new Map<number, Map<number, number[]>>();
const bm25Cache = new Map<number, MiniSearch<{ id: number; text: string; page: number; granularity: string; rects: string }>>();

async function buildBM25Index(paperId: number, data: PaperChunkData): Promise<void> {
  const index = new MiniSearch({ fields: ['text'], storeFields: ['id', 'text', 'page', 'granularity', 'rects'] });
  const docs = data.texts
    .map((text, i) => ({ id: i, text, page: data.pages[i], granularity: data.granularities[i], rects: JSON.stringify(data.rects[i]) }))
    .filter(d => d.granularity === 'paragraph' || d.granularity === 'sentence');
  await index.addAllAsync(docs);
  bm25Cache.set(paperId, index);
}

async function loadPaperChunks(paperId: number, paperTitle: string): Promise<void> {
  if (chunkCache.has(paperId)) return;

  const [meta, embBuf] = await Promise.all([
    workspace.getChunksMeta(paperId),
    workspace.getEmbeddingsBin(paperId),
  ]);

  if (!meta) return;

  const data: PaperChunkData = {
    paperId,
    paperTitle,
    texts: meta.chunks.map(c => c.text),
    pages: meta.chunks.map(c => c.page),
    granularities: meta.chunks.map(c => c.granularity),
    parentIndices: meta.chunks.map(c => c.parent_idx),
    rects: meta.chunks.map(c => c.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 }),
    embeddings: embBuf && meta.embedding_dim > 0 ? new Float32Array(embBuf) : new Float32Array(0),
    embDim: meta.embedding_dim,
    embeddingModel: meta.embedding_model ?? '',
  };

  chunkCache.set(paperId, data);
  // Always build BM25 so mixed-model projects always have a fallback
  await buildBM25Index(paperId, data);
}

async function loadPassageEmbeddings(paperId: number): Promise<void> {
  if (passageEmbCache.has(paperId)) return;
  const items = await workspace.getPassageEmbeddings(paperId);
  passageEmbCache.set(paperId, new Map(items.map(e => [e.id, e.embedding])));
}

export function clearChunkCache(paperId?: number): void {
  if (paperId != null) {
    chunkCache.delete(paperId);
    passageEmbCache.delete(paperId);
    bm25Cache.delete(paperId);
  } else {
    chunkCache.clear();
    passageEmbCache.clear();
    bm25Cache.clear();
  }
}

/** Call after model training to clear the projected key cache for a project. */
export function clearProjectedKeyCache(projectId: number): void {
  clearModel(projectId);
}

export async function preloadProjectEmbeddings(projectId: number, currentPaperId: number): Promise<void> {
  try {
    const papers = await workspace.getProjectPapers(projectId);
    await Promise.all([
      ...papers
        .filter(p => p.id !== currentPaperId)
        .map(p => Promise.all([loadPaperChunks(p.id, p.title), loadPassageEmbeddings(p.id)])),
      loadModel(projectId),
    ]);
  } catch (e) {
    console.warn('Preload failed:', e);
  }
}

/** Load chunks for the current paper (needed for Q&A). */
export async function loadCurrentPaperChunks(paperId: number, paperTitle: string): Promise<PaperChunkData | null> {
  await loadPaperChunks(paperId, paperTitle);
  return chunkCache.get(paperId) ?? null;
}

function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

type RawHit =
  | { source: 'chunk'; paperId: number; idx: number; sim: number }
  | { source: 'passage'; paperId: number; passageId: number; sim: number };

/** Cosine search — only queries papers whose embedding model matches current config. */
export async function computeSimilar(
  queryEmbedding: number[],
  projectId: number,
  currentPaperId: number,
  limit = 10,
): Promise<SimilarPassage[]> {
  const papers = await workspace.getProjectPapers(projectId);
  const others = papers.filter(p => p.id !== currentPaperId);
  const currentModelId = getEmbeddingModelId();

  await Promise.all(
    others.map(p => Promise.all([loadPaperChunks(p.id, p.title), loadPassageEmbeddings(p.id)])),
  );

  const qEmb = new Float32Array(queryEmbedding);
  const projQ = projectQuery(projectId, qEmb);
  const hits: RawHit[] = [];

  for (const paper of others) {
    const cached = chunkCache.get(paper.id);
    if (!cached || cached.embDim === 0 || cached.embeddingModel !== currentModelId) continue;
    const { embeddings, embDim, granularities } = cached;
    const n = cached.texts.length;
    const projKeys = getProjectedKeys(projectId, paper.id, embeddings, embDim, n);
    for (let i = 0; i < n; i++) {
      const g = granularities[i];
      if (g !== 'sentence' && g !== 'paragraph') continue;
      hits.push({ source: 'chunk', paperId: paper.id, idx: i, sim: dotSim(projQ, projKeys.subarray(i * embDim, (i + 1) * embDim)) });
    }
  }

  for (const paper of others) {
    const cached = chunkCache.get(paper.id);
    if (!cached || cached.embeddingModel !== currentModelId) continue;
    const embMap = passageEmbCache.get(paper.id);
    if (!embMap) continue;
    for (const [passageId, emb] of embMap) {
      hits.push({ source: 'passage', paperId: paper.id, passageId, sim: dotSim(projQ, projectKey(projectId, new Float32Array(emb))) });
    }
  }

  return resolveHits(hits, papers, limit);
}

/** BM25 search — queries papers that lack matching embeddings. */
export async function computeSimilarBM25(
  queryText: string,
  projectId: number,
  currentPaperId: number,
  limit = 10,
): Promise<SimilarPassage[]> {
  const papers = await workspace.getProjectPapers(projectId);
  const others = papers.filter(p => p.id !== currentPaperId);

  await Promise.all(others.map(p => loadPaperChunks(p.id, p.title)));

  const hits: RawHit[] = [];

  for (const paper of others) {
    const index = bm25Cache.get(paper.id);
    if (!index) continue;
    const results = index.search(queryText, { boost: { text: 1 }, fuzzy: 0.2 });
    if (!results.length) continue;
    const maxScore = results[0].score;
    for (const r of results) {
      hits.push({ source: 'chunk', paperId: paper.id, idx: r.id as number, sim: r.score / maxScore });
    }
  }

  return resolveHits(hits, papers, limit);
}

/**
 * Unified search across a project.
 * Uses cosine for papers with matching embeddings, BM25 for the rest.
 * Results from both paths are merged and re-ranked by normalized score.
 */
export async function computeSimilarAll(
  queryEmbedding: number[] | null,
  queryText: string,
  projectId: number,
  currentPaperId: number,
  limit = 10,
): Promise<SimilarPassage[]> {
  const papers = await workspace.getProjectPapers(projectId);
  const others = papers.filter(p => p.id !== currentPaperId);
  const currentModelId = getEmbeddingModelId();

  await Promise.all(
    others.map(p => Promise.all([loadPaperChunks(p.id, p.title), loadPassageEmbeddings(p.id)])),
  );

  const cosineHits: RawHit[] = [];
  const bm25Hits: RawHit[] = [];

  const qEmb = queryEmbedding ? new Float32Array(queryEmbedding) : null;
  const projQ = qEmb ? projectQuery(projectId, qEmb) : null;

  for (const paper of others) {
    const cached = chunkCache.get(paper.id);
    const isCurrentModel = cached && cached.embDim > 0 && cached.embeddingModel === currentModelId;

    if (isCurrentModel && projQ) {
      // Dense path — uses learned projection when available, otherwise plain cosine
      const { embeddings, embDim, granularities } = cached!;
      const n = cached!.texts.length;
      const projKeys = getProjectedKeys(projectId, paper.id, embeddings, embDim, n);
      for (let i = 0; i < n; i++) {
        const g = granularities[i];
        if (g !== 'sentence' && g !== 'paragraph') continue;
        cosineHits.push({ source: 'chunk', paperId: paper.id, idx: i, sim: dotSim(projQ, projKeys.subarray(i * embDim, (i + 1) * embDim)) });
      }
      // Passage embeddings
      const embMap = passageEmbCache.get(paper.id);
      if (embMap) {
        for (const [passageId, emb] of embMap) {
          cosineHits.push({ source: 'passage', paperId: paper.id, passageId, sim: dotSim(projQ, projectKey(projectId, new Float32Array(emb))) });
        }
      }
    } else {
      // BM25 fallback for this paper
      const index = bm25Cache.get(paper.id);
      if (!index || !queryText.trim()) continue;
      const results = index.search(queryText, { boost: { text: 1 }, fuzzy: 0.2 });
      if (!results.length) continue;
      const maxScore = results[0].score;
      for (const r of results) {
        bm25Hits.push({ source: 'chunk', paperId: paper.id, idx: r.id as number, sim: r.score / maxScore });
      }
    }
  }

  // Normalize cosine hits (already 0–1 by definition but clamp to be safe)
  // Merge both sets — they're on the same 0–1 scale after BM25 normalization
  const allHits: RawHit[] = [...cosineHits, ...bm25Hits];
  return resolveHits(allHits, papers, limit);
}

/** Shared resolution logic for both embedding and BM25 hits. */
async function resolveHits(
  hits: RawHit[],
  papers: Array<{ id: number; title: string }>,
  limit: number,
): Promise<SimilarPassage[]> {
  hits.sort((a, b) => b.sim - a.sim);

  // Sentence wins over its parent paragraph
  const sentenceParentsCovered = new Set<string>();
  for (const hit of hits) {
    if (hit.source === 'chunk') {
      const cached = chunkCache.get(hit.paperId)!;
      if (cached?.granularities[hit.idx] === 'sentence') {
        const parentIdx = cached.parentIndices[hit.idx];
        if (parentIdx >= 0) sentenceParentsCovered.add(`${hit.paperId}:${parentIdx}`);
      }
    }
  }

  const seen = new Set<string>();
  const results: SimilarPassage[] = [];

  for (const hit of hits) {
    if (results.length >= limit) break;

    if (hit.source === 'chunk') {
      const key = `chunk:${hit.paperId}:${hit.idx}`;
      if (seen.has(key)) continue;
      const cached = chunkCache.get(hit.paperId);
      if (!cached) continue;
      const gran = cached.granularities[hit.idx];
      if (gran === 'paragraph' && sentenceParentsCovered.has(`${hit.paperId}:${hit.idx}`)) continue;
      seen.add(key);
      results.push({
        passage_id: hit.idx,
        paper_id: hit.paperId,
        paper_title: cached.paperTitle,
        page: cached.pages[hit.idx],
        text: cached.texts[hit.idx],
        similarity: hit.sim,
        rects: [cached.rects[hit.idx]],
        tags: [],
        source: 'chunk',
      });
    } else {
      const key = `passage:${hit.paperId}:${hit.passageId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const paper = papers.find(p => p.id === hit.paperId);
      results.push({
        passage_id: hit.passageId,
        paper_id: hit.paperId,
        paper_title: paper?.title ?? '',
        page: 0,
        text: '',
        similarity: hit.sim,
        rects: [],
        tags: [],
        source: 'passage',
      });
    }
  }

  // Hydrate passage-source results
  const passageResults = results.filter(r => r.source === 'passage');
  if (passageResults.length > 0) {
    const byPaper = new Map<number, SimilarPassage[]>();
    for (const r of passageResults) {
      if (!byPaper.has(r.paper_id)) byPaper.set(r.paper_id, []);
      byPaper.get(r.paper_id)!.push(r);
    }
    await Promise.all(
      [...byPaper.entries()].map(async ([paperId, items]) => {
        try {
          const passages: Passage[] = await workspace.getPassages(paperId);
          const pMap = new Map(passages.map(p => [p.id, p]));
          for (const item of items) {
            const p = pMap.get(item.passage_id);
            if (p) { item.page = p.page; item.text = p.text; item.rects = p.rects; item.tags = p.tags; }
          }
        } catch (_) {}
      }),
    );
  }

  return results.filter(r => r.text);
}
