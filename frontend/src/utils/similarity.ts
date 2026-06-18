/**
 * Client-side similarity search over chunk embeddings.
 * Chunks are fetched once per paper and cached in memory for the tab's lifetime.
 */

import { api, type SimilarPassage } from '../api';

interface PaperChunkData {
  paperId: number;
  paperTitle: string;
  texts: string[];
  pages: number[];
  granularities: string[];
  parentIndices: number[];
  rects: Array<{ x: number; y: number; width: number; height: number }>;
  embeddings: Float32Array;
  embDim: number;
}

// Module-level cache — survives re-renders, cleared only on page reload
const chunkCache = new Map<number, PaperChunkData>();
const passageEmbCache = new Map<number, Map<number, number[]>>(); // paperId → {passageId → embedding}

async function loadPaperChunks(paperId: number, paperTitle: string): Promise<void> {
  if (chunkCache.has(paperId)) return;

  const [meta, embBuf] = await Promise.all([
    api.getPaperChunks(paperId),
    api.getPaperEmbeddingsBin(paperId),
  ]);

  chunkCache.set(paperId, {
    paperId,
    paperTitle,
    texts: meta.chunks.map(c => c.text),
    pages: meta.chunks.map(c => c.page),
    granularities: meta.chunks.map(c => c.granularity),
    parentIndices: meta.chunks.map(c => c.parent_idx),
    rects: meta.chunks.map(c => c.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 }),
    embeddings: new Float32Array(embBuf),
    embDim: meta.embedding_dim,
  });
}

async function loadPassageEmbeddings(paperId: number): Promise<void> {
  if (passageEmbCache.has(paperId)) return;
  const items = await api.getPassageEmbeddings(paperId);
  passageEmbCache.set(paperId, new Map(items.map(e => [e.id, e.embedding])));
}

/** Pre-fetch chunk + passage embeddings for all papers in a project. Fire-and-forget. */
export async function preloadProjectEmbeddings(
  projectId: number,
  currentPaperId: number,
): Promise<void> {
  try {
    const papers = await api.listPapers(projectId);
    await Promise.all(
      papers
        .filter(p => p.id !== currentPaperId)
        .map(p => Promise.all([loadPaperChunks(p.id, p.title), loadPassageEmbeddings(p.id)])),
    );
  } catch (e) {
    console.warn('Preload failed:', e);
  }
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

/** Compute similar passages across all other project papers for a given embedding. */
export async function computeSimilar(
  queryEmbedding: number[],
  projectId: number,
  currentPaperId: number,
  limit = 10,
): Promise<SimilarPassage[]> {
  const papers = await api.listPapers(projectId);
  const others = papers.filter(p => p.id !== currentPaperId);

  await Promise.all(
    others.map(p => Promise.all([loadPaperChunks(p.id, p.title), loadPassageEmbeddings(p.id)])),
  );

  const qEmb = new Float32Array(queryEmbedding);

  type Hit = { source: 'chunk'; paperId: number; idx: number; sim: number }
           | { source: 'passage'; paperId: number; passageId: number; sim: number };

  const hits: Hit[] = [];

  // Score chunk embeddings (sentence + paragraph only)
  for (const paper of others) {
    const cached = chunkCache.get(paper.id);
    if (!cached || cached.embDim === 0) continue;
    const { embeddings, embDim, granularities } = cached;
    const n = cached.texts.length;
    for (let i = 0; i < n; i++) {
      const g = granularities[i];
      if (g !== 'sentence' && g !== 'paragraph') continue;
      const emb = embeddings.subarray(i * embDim, (i + 1) * embDim);
      hits.push({ source: 'chunk', paperId: paper.id, idx: i, sim: cosineSimilarity(qEmb, emb) });
    }
  }

  // Score passage highlight embeddings
  for (const paper of others) {
    const embMap = passageEmbCache.get(paper.id);
    if (!embMap) continue;
    for (const [passageId, emb] of embMap) {
      hits.push({ source: 'passage', paperId: paper.id, passageId, sim: cosineSimilarity(qEmb, emb) });
    }
  }

  hits.sort((a, b) => b.sim - a.sim);

  // Sentence wins over its parent paragraph (same dedup logic as old backend)
  const sentenceParentsCovered = new Set<string>();
  for (const hit of hits) {
    if (hit.source === 'chunk') {
      const cached = chunkCache.get(hit.paperId)!;
      if (cached.granularities[hit.idx] === 'sentence') {
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
      const cached = chunkCache.get(hit.paperId)!;
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

  // Hydrate passage-source results (need text/page/rects from the API)
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
          const passages = await api.listPassages(paperId);
          const pMap = new Map(passages.map(p => [p.id, p]));
          for (const item of items) {
            const p = pMap.get(item.passage_id);
            if (p) {
              item.page = p.page;
              item.text = p.text;
              item.rects = p.rects;
              item.tags = p.tags;
            }
          }
        } catch (_) {}
      }),
    );
  }

  return results.filter(r => r.text);
}
