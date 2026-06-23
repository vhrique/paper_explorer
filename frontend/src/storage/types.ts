export interface StorageAdapter {
  connect(): Promise<void>;
  isConnected(): boolean;
  tryRestoreFromIDB(): Promise<boolean>;

  readJSON<T>(path: string): Promise<T | null>;
  writeJSON(path: string, data: unknown): Promise<void>;

  readBinary(path: string): Promise<ArrayBuffer | null>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;

  writeFile(path: string, file: File): Promise<void>;
  getFileBlob(path: string): Promise<Blob | null>;

  deleteFile(path: string): Promise<void>;
  deleteDirectory(path: string): Promise<void>;
}

// ---- stored shapes (on-disk) ----

export interface WorkspaceData {
  _next_id: number;
  projects: StoredProject[];
  tags: StoredTag[];
  paper_ids: number[];
  passage_links: StoredPassageLink[];
}

export interface StoredProject {
  id: number;
  name: string;
  description?: string;
  created_at: string;
}

export interface StoredTag {
  id: number;
  name: string;
  type: 'content' | 'paper';
  project_id?: number;
  created_at: string;
}

export interface StoredPassageLink {
  id: number;
  passage_id_1: number;
  passage_id_2: number;
  created_at: string;
}

export interface StoredPaperMeta {
  id: number;
  title: string;
  filename: string;
  doi?: string;
  arxiv_id?: string;
  abstract?: string;
  created_at: string;
  project_ids: number[];
  embedding_model?: string;  // '' or absent = no embeddings; set = model identity key
}

export type EmbeddingStatus = 'none' | 'current' | 'stale';

export interface StoredPassage {
  id: number;
  paper_id: number;
  page: number;
  text: string;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
  color: string;
  embedding?: number[];
  tag_ids: number[];
  created_at: string;
}

export interface StoredNote {
  id: number;
  type: 'passage' | 'tag';
  content: string;
  passage_ids: number[];
  tag_ids: number[];
  embedding?: number[];
  created_at: string;
  updated_at: string;
}

export interface StoredAnnotations {
  passages: StoredPassage[];
  notes: StoredNote[];
}

export interface StoredChunksMeta {
  embedding_dim: number;
  embedding_model: string;  // '' when no embeddings
  chunks: StoredChunk[];
}

export interface StoredChunk {
  idx: number;
  text: string;
  page: number;
  granularity: string;
  parent_idx: number;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
}
