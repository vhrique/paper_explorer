import { processPaperClientSide, embedChunkTexts } from '../services/pdfProcessor';
import { embedText as embedTextService } from '../services/embeddingService';
import { fetchPaperMetadata } from '../services/metadataService';

// ---- Geometry ----

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---- Chunks / retrieval ----

export interface ChunkResult {
  chunk_id: number;
  page: number;
  text: string;
  similarity: number;
  rects: Rect[];
}

export interface ChunkMetaItem {
  idx: number;
  text: string;
  page: number;
  granularity: string;
  parent_idx: number;
  rects: Rect[];
}

export interface ProcessResponse {
  metadata: { title: string; filename: string; doi?: string; arxiv_id?: string; abstract?: string };
  embeddings_bin_b64: string;
  chunk_meta: ChunkMetaItem[];
  embedding_dim: number;
  embedding_model: string; // '' when no API configured
}

export interface PaperMetadataResult {
  title?: string;
  doi?: string;
  abstract?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  source: string;
}

// ---- Single-paper reader ----

export type AnnotationKind = 'highlight' | 'note' | 'region';

/** A PDF-native annotation, round-tripped through the file itself. */
export interface Annotation {
  id: string; // PDF /NM — stable across saves
  kind: AnnotationKind;
  page: number; // 0-based
  rects: Rect[]; // normalized, top-left origin. highlight: per-line; note/region: one rect
  color: string; // hex
  comment: string; // '' for a bare highlight/region
  text?: string; // recovered text under the annotation (best-effort, not persisted)
  updatedAt: string;
}

/** A passage or region the user pinned to ask the chat about. */
export interface QuoteContext {
  page: number; // 0-based
  rects: Rect[]; // normalized, top-left
  text: string;
  kind: 'text' | 'region';
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  locations?: ChunkResult[];
  /** true when `locations` are the passages the model cited, not a search guess. */
  cited?: boolean;
  citedNote?: string;
  /** how many passages were sent to the model, and the paper's total */
  passagesSent?: number;
  passagesTotal?: number;
  /** 'full' = whole paper; 'window' = what fit the context; 'region' = slice around a selection */
  mode?: 'full' | 'window' | 'region';
  /** estimated token counts for the size readout */
  paperTokens?: number;
  contextTokens?: number;
  quote?: QuoteContext | null;
}

// ---- Client-side API ----

export const api = {
  processPaper: (
    file: File,
    onProgress?: (stage: string) => void,
    opts?: { embed?: boolean },
  ): Promise<ProcessResponse> => processPaperClientSide(file, onProgress, opts),

  embedChunks: embedChunkTexts,

  embedText: (text: string): Promise<{ embedding: number[] }> =>
    embedTextService(text).then(embedding => ({ embedding })),

  fetchMetadata: (doi?: string, arxiv_id?: string, title?: string): Promise<PaperMetadataResult> =>
    fetchPaperMetadata(doi, arxiv_id, title),
};
