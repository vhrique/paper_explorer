import { processPaperClientSide } from '../services/pdfProcessor';
import { embedText as embedTextService } from '../services/embeddingService';
import { answerQuestion } from '../services/llmService';
import { fetchPaperMetadata } from '../services/metadataService';

// ---- Shared types (used by both API and storage layer) ----

export interface Project {
  id: number;
  name: string;
  description?: string;
  created_at: string;
}

export interface Paper {
  id: number;
  title: string;
  filename: string;
  doi?: string;
  arxiv_id?: string;
  abstract?: string;
  created_at: string;
  url?: string;
  project_ids: number[];
}

export interface Tag {
  id: number;
  name: string;
  type: 'content' | 'paper';
  project_id?: number;
  created_at: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Passage {
  id: number;
  paper_id: number;
  page: number;
  text: string;
  rects: Rect[];
  color: string;
  created_at: string;
  tags: Tag[];
}

export interface Note {
  id: number;
  type: 'passage' | 'tag';
  content: string;
  created_at: string;
  updated_at: string;
  passage_ids: number[];
  tag_ids: number[];
}

export interface PassageLink {
  id: number;
  passage_id_1: number;
  passage_id_2: number;
  created_at: string;
}

export interface PassageLinkDetail {
  id: number;
  local_passage_id: number;
  local_passage_text: string;
  local_page: number;
  remote_passage_id: number;
  remote_passage_text: string;
  remote_page: number;
  remote_rects: Rect[];
  remote_paper_id: number;
  remote_paper_title: string;
  created_at: string;
}

export interface SimilarPassage {
  passage_id: number;
  paper_id: number;
  paper_title: string;
  page: number;
  text: string;
  similarity: number;
  rects: Rect[];
  tags: Tag[];
  source: 'passage' | 'chunk';
}

export interface ChunkResult {
  chunk_id: number;
  page: number;
  text: string;
  similarity: number;
  rects: Rect[];
}

export interface SearchResponse {
  answer: string | null;
  chunks: ChunkResult[];
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
  embedding_model: string;  // '' when no API configured
}

// ---- Client-side implementations of the former backend API ----

export const api = {
  processPaper: (file: File): Promise<ProcessResponse> =>
    processPaperClientSide(file),

  embedText: (text: string): Promise<{ embedding: number[] }> =>
    embedTextService(text).then(embedding => ({ embedding })),

  qa: (
    query: string,
    paper_title: string,
    chunks: Array<{ text: string; page: number }>,
  ): Promise<{ answer: string | null }> =>
    answerQuestion(query, paper_title, chunks).then(answer => ({ answer })),

  fetchMetadata: (doi?: string, arxiv_id?: string, title?: string): Promise<PaperMetadataResult> =>
    fetchPaperMetadata(doi, arxiv_id, title),
};
