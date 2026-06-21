/**
 * All application CRUD lives here.
 * State: one `workspace.json` loaded in memory. Per-paper files are read/written on demand.
 */

import type { StorageAdapter, WorkspaceData, StoredPaperMeta, StoredAnnotations, StoredPassage, StoredNote, StoredChunksMeta, EmbeddingStatus } from './types';
import type { Project, Paper, Tag, Passage, Note, PassageLink, PassageLinkDetail, Rect } from '../api';
import { embedBatch } from '../services/embeddingService';
import { getEmbeddingModelId, hasEmbeddingConfig, type AppSettings } from '../services/settingsService';

let _adapter: StorageAdapter | null = null;
let _ws: WorkspaceData | null = null;
const _blobUrlCache = new Map<number, string>();
const _passagePaperCache = new Map<number, number>(); // passageId → paperId

const EMPTY_WS: WorkspaceData = {
  _next_id: 1,
  projects: [],
  tags: [],
  paper_ids: [],
  passage_links: [],
};

function now(): string {
  return new Date().toISOString();
}

export function setAdapter(adapter: StorageAdapter): void {
  _adapter = adapter;
  _ws = null;
  _blobUrlCache.clear();
  _passagePaperCache.clear();
}

export function isStorageConnected(): boolean {
  return _adapter !== null && _adapter.isConnected();
}

export async function getStorageSettings(): Promise<AppSettings | null> {
  return adapter().readJSON<AppSettings>('settings.json');
}

export async function saveStorageSettings(s: AppSettings): Promise<void> {
  await adapter().writeJSON('settings.json', s);
}

// ---------------------------------------------------------------------------
// Passage links (project-wide)
// ---------------------------------------------------------------------------

export async function getAllPassageLinks(): Promise<Array<{ passage_id_1: number; passage_id_2: number }>> {
  const workspace = await ws();
  return workspace.passage_links.map(l => ({ passage_id_1: l.passage_id_1, passage_id_2: l.passage_id_2 }));
}

// ---------------------------------------------------------------------------
// Similarity model weights
// ---------------------------------------------------------------------------

export async function getProjectModelWeights(
  projectId: number,
): Promise<{ dim: number; queryWeight: number[]; keyWeight: number[] } | null> {
  return adapter().readJSON(`models/project_${projectId}/similarity_projection.json`);
}

export async function saveProjectModelWeights(
  projectId: number,
  data: { dim: number; queryWeight: number[]; keyWeight: number[] },
): Promise<void> {
  await adapter().writeJSON(`models/project_${projectId}/similarity_projection.json`, data);
}

export async function deleteProjectModel(projectId: number): Promise<void> {
  try {
    await adapter().deleteFile(`models/project_${projectId}/similarity_projection.json`);
  } catch { /* file may not exist */ }
}

function adapter(): StorageAdapter {
  if (!_adapter) throw new Error('Storage not connected');
  return _adapter;
}

async function ws(): Promise<WorkspaceData> {
  if (_ws) return _ws;
  const loaded = await adapter().readJSON<WorkspaceData>('workspace.json');
  _ws = loaded ?? { ...EMPTY_WS };
  return _ws;
}

async function saveWs(): Promise<void> {
  await adapter().writeJSON('workspace.json', _ws);
}

function allocId(workspace: WorkspaceData): number {
  const id = workspace._next_id;
  workspace._next_id++;
  return id;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function getProjects(): Promise<Project[]> {
  return (await ws()).projects as Project[];
}

export async function createProject(name: string, description?: string): Promise<Project> {
  const workspace = await ws();
  const project: Project = { id: allocId(workspace), name, description, created_at: now() };
  workspace.projects.push(project);
  await saveWs();
  return project;
}

export async function deleteProject(id: number): Promise<void> {
  const workspace = await ws();
  workspace.projects = workspace.projects.filter(p => p.id !== id);
  await saveWs();
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function getTags(projectId?: number): Promise<Tag[]> {
  const workspace = await ws();
  const all = workspace.tags as Tag[];
  if (projectId == null) return all;
  return all.filter(t => t.project_id == null || t.project_id === projectId);
}

export async function createTag(name: string, type: 'content' | 'paper', projectId?: number): Promise<Tag> {
  const workspace = await ws();
  const tag: Tag = { id: allocId(workspace), name, type, project_id: projectId, created_at: now() };
  workspace.tags.push(tag);
  await saveWs();
  return tag;
}

export async function deleteTag(id: number): Promise<void> {
  const workspace = await ws();
  workspace.tags = workspace.tags.filter(t => t.id !== id);
  await saveWs();
}

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------

async function loadPaperMeta(id: number): Promise<StoredPaperMeta | null> {
  return adapter().readJSON<StoredPaperMeta>(`papers/${id}/metadata.json`);
}

async function savePaperMeta(meta: StoredPaperMeta): Promise<void> {
  await adapter().writeJSON(`papers/${meta.id}/metadata.json`, meta);
}

function hydratePaper(meta: StoredPaperMeta): Paper {
  return {
    id: meta.id,
    title: meta.title,
    filename: meta.filename,
    doi: meta.doi,
    arxiv_id: meta.arxiv_id,
    abstract: meta.abstract,
    created_at: meta.created_at,
    project_ids: meta.project_ids,
  };
}

export async function getAllPapers(): Promise<Paper[]> {
  const workspace = await ws();
  const results = await Promise.all(workspace.paper_ids.map(loadPaperMeta));
  return results.filter((m): m is StoredPaperMeta => m !== null).map(hydratePaper);
}

export async function getProjectPapers(projectId: number): Promise<Paper[]> {
  const all = await getAllPapers();
  return all.filter(p => p.project_ids.includes(projectId));
}

export async function getPaperById(id: number): Promise<Paper | null> {
  const meta = await loadPaperMeta(id);
  return meta ? hydratePaper(meta) : null;
}

export interface ProcessResult {
  metadata: { title: string; filename: string; doi?: string; arxiv_id?: string; abstract?: string };
  embeddings_bin_b64: string;
  chunk_meta: Array<{ idx: number; text: string; page: number; granularity: string; parent_idx: number; rects: Rect[] }>;
  embedding_dim: number;
  embedding_model: string;
}

export async function registerPaper(
  result: ProcessResult,
  pdfFile: File,
  projectId?: number,
): Promise<Paper> {
  const workspace = await ws();
  const id = allocId(workspace);
  const project_ids = projectId != null ? [projectId] : [];
  const meta: StoredPaperMeta = {
    id,
    title: result.metadata.title,
    filename: pdfFile.name,
    doi: result.metadata.doi,
    arxiv_id: result.metadata.arxiv_id,
    abstract: result.metadata.abstract,
    created_at: now(),
    project_ids,
    embedding_model: result.embedding_model,
  };

  // Save PDF
  await adapter().writeFile(`papers/${id}/${pdfFile.name}`, pdfFile);

  // Save metadata
  await savePaperMeta(meta);

  // Save chunk meta
  const chunksMeta: StoredChunksMeta = {
    embedding_dim: result.embedding_dim,
    embedding_model: result.embedding_model,
    chunks: result.chunk_meta,
  };
  await adapter().writeJSON(`papers/${id}/chunks_meta.json`, chunksMeta);

  // Save embeddings binary
  if (result.embeddings_bin_b64) {
    const binStr = atob(result.embeddings_bin_b64);
    const buf = new ArrayBuffer(binStr.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < binStr.length; i++) view[i] = binStr.charCodeAt(i);
    await adapter().writeBinary(`papers/${id}/embeddings.bin`, buf);
  }

  // Empty annotations
  await adapter().writeJSON(`papers/${id}/annotations.json`, { passages: [], notes: [] });

  // Update workspace
  workspace.paper_ids.push(id);
  await saveWs();

  return hydratePaper(meta);
}

export async function updatePaperMetadata(id: number, fields: Partial<Pick<Paper, 'title' | 'doi' | 'arxiv_id' | 'abstract'>>): Promise<Paper> {
  const meta = await loadPaperMeta(id);
  if (!meta) throw new Error(`Paper ${id} not found`);
  Object.assign(meta, fields);
  await savePaperMeta(meta);
  return hydratePaper(meta);
}

export async function deletePaper(id: number): Promise<void> {
  const workspace = await ws();
  workspace.paper_ids = workspace.paper_ids.filter(pid => pid !== id);
  // Remove any passage links involving this paper's passages
  const ann = await loadAnnotations(id);
  const passageIds = new Set(ann.passages.map(p => p.id));
  workspace.passage_links = workspace.passage_links.filter(
    l => !passageIds.has(l.passage_id_1) && !passageIds.has(l.passage_id_2),
  );
  await saveWs();
  await adapter().deleteDirectory(`papers/${id}`);
  _blobUrlCache.delete(id);
}

export async function addPaperToProject(paperId: number, projectId: number): Promise<void> {
  const meta = await loadPaperMeta(paperId);
  if (!meta) return;
  if (!meta.project_ids.includes(projectId)) {
    meta.project_ids.push(projectId);
    await savePaperMeta(meta);
  }
}

export async function removePaperFromProject(paperId: number, projectId: number): Promise<void> {
  const meta = await loadPaperMeta(paperId);
  if (!meta) return;
  meta.project_ids = meta.project_ids.filter(id => id !== projectId);
  await savePaperMeta(meta);
}

export async function getPdfBlobUrl(paperId: number): Promise<string> {
  if (_blobUrlCache.has(paperId)) return _blobUrlCache.get(paperId)!;
  const meta = await loadPaperMeta(paperId);
  if (!meta) throw new Error(`No metadata for paper ${paperId}`);
  const blob = await adapter().getFileBlob(`papers/${paperId}/${meta.filename}`);
  if (!blob) throw new Error(`PDF not found for paper ${paperId}`);
  const url = URL.createObjectURL(blob);
  _blobUrlCache.set(paperId, url);
  return url;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

async function loadAnnotations(paperId: number): Promise<StoredAnnotations> {
  const ann = await adapter().readJSON<StoredAnnotations>(`papers/${paperId}/annotations.json`);
  return ann ?? { passages: [], notes: [] };
}

async function saveAnnotations(paperId: number, ann: StoredAnnotations): Promise<void> {
  await adapter().writeJSON(`papers/${paperId}/annotations.json`, ann);
}

// ---------------------------------------------------------------------------
// Passages
// ---------------------------------------------------------------------------

function hydratePassage(sp: StoredPassage, tagMap: Map<number, Tag>): Passage {
  return {
    id: sp.id,
    paper_id: sp.paper_id,
    page: sp.page,
    text: sp.text,
    rects: sp.rects,
    color: sp.color,
    created_at: sp.created_at,
    tags: (sp.tag_ids ?? []).map(tid => tagMap.get(tid)).filter(Boolean) as Tag[],
  };
}

export async function getPassages(paperId: number): Promise<Passage[]> {
  const [ann, workspace] = await Promise.all([loadAnnotations(paperId), ws()]);
  const tagMap = new Map(workspace.tags.map(t => [t.id, t as Tag]));
  return ann.passages.map(p => hydratePassage(p, tagMap));
}

export async function createPassage(
  paperId: number,
  data: { page: number; text: string; rects: Rect[]; color?: string; embedding?: number[] },
): Promise<Passage> {
  const workspace = await ws();
  const ann = await loadAnnotations(paperId);
  const sp: StoredPassage = {
    id: allocId(workspace),
    paper_id: paperId,
    page: data.page,
    text: data.text,
    rects: data.rects,
    color: data.color ?? '#FDE047',
    embedding: data.embedding,
    tag_ids: [],
    created_at: now(),
  };
  ann.passages.push(sp);
  await Promise.all([saveAnnotations(paperId, ann), saveWs()]);
  const tagMap = new Map(workspace.tags.map(t => [t.id, t as Tag]));
  return hydratePassage(sp, tagMap);
}

export async function updatePassage(passageId: number, paperId: number, fields: { color?: string }): Promise<Passage> {
  const workspace = await ws();
  const ann = await loadAnnotations(paperId);
  const sp = ann.passages.find(p => p.id === passageId);
  if (!sp) throw new Error(`Passage ${passageId} not found`);
  Object.assign(sp, fields);
  await saveAnnotations(paperId, ann);
  const tagMap = new Map(workspace.tags.map(t => [t.id, t as Tag]));
  return hydratePassage(sp, tagMap);
}

export async function deletePassage(passageId: number, paperId: number): Promise<void> {
  const workspace = await ws();
  const ann = await loadAnnotations(paperId);
  ann.passages = ann.passages.filter(p => p.id !== passageId);
  ann.notes = ann.notes.filter(n => !n.passage_ids.includes(passageId));
  workspace.passage_links = workspace.passage_links.filter(
    l => l.passage_id_1 !== passageId && l.passage_id_2 !== passageId,
  );
  await Promise.all([saveAnnotations(paperId, ann), saveWs()]);
}

export async function addPassageTag(passageId: number, tagId: number, paperId: number): Promise<void> {
  const ann = await loadAnnotations(paperId);
  const sp = ann.passages.find(p => p.id === passageId);
  if (sp && !sp.tag_ids.includes(tagId)) {
    sp.tag_ids.push(tagId);
    await saveAnnotations(paperId, ann);
  }
}

export async function removePassageTag(passageId: number, tagId: number, paperId: number): Promise<void> {
  const ann = await loadAnnotations(paperId);
  const sp = ann.passages.find(p => p.id === passageId);
  if (sp) {
    sp.tag_ids = sp.tag_ids.filter(id => id !== tagId);
    await saveAnnotations(paperId, ann);
  }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function hydrateNote(sn: StoredNote): Note {
  return {
    id: sn.id,
    type: sn.type,
    content: sn.content,
    created_at: sn.created_at,
    updated_at: sn.updated_at,
    passage_ids: sn.passage_ids,
    tag_ids: sn.tag_ids,
  };
}

export async function getNotes(paperId: number): Promise<Note[]> {
  const ann = await loadAnnotations(paperId);
  return ann.notes.map(hydrateNote);
}

export async function getPassageNotes(passageId: number, paperId: number, projectId?: number): Promise<Note[]> {
  const own = await loadAnnotations(paperId);
  const ownNotes = own.notes.filter(n => n.passage_ids.includes(passageId)).map(hydrateNote);

  if (projectId == null) return ownNotes;

  // Also collect notes from other project papers that reference this passageId
  // (notes spread via addPassageToNote live in the source paper's file)
  const workspace = await ws();
  const otherPaperIds = workspace.paper_ids.filter(id => id !== paperId);
  const seen = new Set(ownNotes.map(n => n.id));
  const extra: Note[] = [];
  await Promise.all(otherPaperIds.map(async (pid) => {
    const ann = await loadAnnotations(pid);
    for (const sn of ann.notes) {
      if (!seen.has(sn.id) && sn.passage_ids.includes(passageId)) {
        seen.add(sn.id);
        extra.push(hydrateNote(sn));
      }
    }
  }));
  return [...ownNotes, ...extra];
}

export async function createNote(paperId: number, passageId: number, content: string): Promise<Note> {
  const workspace = await ws();
  const ann = await loadAnnotations(paperId);
  const sn: StoredNote = {
    id: allocId(workspace),
    type: 'passage',
    content,
    passage_ids: [passageId],
    tag_ids: [],
    created_at: now(),
    updated_at: now(),
  };
  ann.notes.unshift(sn);
  await Promise.all([saveAnnotations(paperId, ann), saveWs()]);
  return hydrateNote(sn);
}

export async function deleteNote(noteId: number, paperId: number): Promise<void> {
  const ann = await loadAnnotations(paperId);
  ann.notes = ann.notes.filter(n => n.id !== noteId);
  await saveAnnotations(paperId, ann);
}

export async function updateNote(noteId: number, paperId: number, content: string): Promise<Note> {
  const ann = await loadAnnotations(paperId);
  const sn = ann.notes.find(n => n.id === noteId);
  if (!sn) throw new Error(`Note ${noteId} not found`);
  sn.content = content.trim();
  sn.updated_at = now();
  await saveAnnotations(paperId, ann);
  return hydrateNote(sn);
}

export async function addPassageToNote(noteId: number, sourcePaperId: number, extraPassageId: number): Promise<Note> {
  const ann = await loadAnnotations(sourcePaperId);
  const sn = ann.notes.find(n => n.id === noteId);
  if (!sn) throw new Error(`Note ${noteId} not found`);
  if (!sn.passage_ids.includes(extraPassageId)) {
    sn.passage_ids.push(extraPassageId);
    sn.updated_at = now();
    await saveAnnotations(sourcePaperId, ann);
  }
  return hydrateNote(sn);
}

/** Find which paper (within the project) owns a given passage ID. Caches per session. */
export async function findPassagePaper(passageId: number, projectId: number): Promise<number | null> {
  if (_passagePaperCache.has(passageId)) return _passagePaperCache.get(passageId)!;
  const papers = await getProjectPapers(projectId);
  for (const paper of papers) {
    const ann = await loadAnnotations(paper.id);
    // Warm the full paper's mapping opportunistically
    for (const p of ann.passages) _passagePaperCache.set(p.id, paper.id);
    if (_passagePaperCache.has(passageId)) return paper.id;
  }
  return null;
}

export interface LinkedNote {
  note: Note;
  sourcePaperId: number;
  sourcePassageId: number;
  sourcePaperTitle: string;
}

/** Notes that belong to passages linked to the given passage, excluding already-own notes. */
export async function getLinkedPassageNotes(
  passageId: number,
  paperId: number,
  projectId: number,
): Promise<LinkedNote[]> {
  const workspace = await ws();
  const links = workspace.passage_links.filter(
    l => l.passage_id_1 === passageId || l.passage_id_2 === passageId,
  );
  if (!links.length) return [];

  // Own note IDs to exclude from linked results
  const ownAnn = await loadAnnotations(paperId);
  const ownNoteIds = new Set(ownAnn.notes.filter(n => n.passage_ids.includes(passageId)).map(n => n.id));

  const seen = new Set<number>();
  const results: LinkedNote[] = [];

  await Promise.all(links.map(async (link) => {
    const otherPassageId = link.passage_id_1 === passageId ? link.passage_id_2 : link.passage_id_1;
    const otherPaperId = await findPassagePaper(otherPassageId, projectId);
    if (!otherPaperId) return;
    const [ann, meta] = await Promise.all([loadAnnotations(otherPaperId), loadPaperMeta(otherPaperId)]);
    if (!meta) return;
    for (const sn of ann.notes) {
      if (!sn.passage_ids.includes(otherPassageId)) continue;
      if (seen.has(sn.id) || ownNoteIds.has(sn.id)) continue;
      seen.add(sn.id);
      results.push({
        note: hydrateNote(sn),
        sourcePaperId: otherPaperId,
        sourcePassageId: otherPassageId,
        sourcePaperTitle: meta.title,
      });
    }
  }));

  return results;
}

// ---------------------------------------------------------------------------
// Passage links
// ---------------------------------------------------------------------------

export async function getPassageLinks(paperId: number): Promise<PassageLink[]> {
  const workspace = await ws();
  const ann = await loadAnnotations(paperId);
  const passageIds = new Set(ann.passages.map(p => p.id));
  return workspace.passage_links
    .filter(l => passageIds.has(l.passage_id_1) || passageIds.has(l.passage_id_2))
    .map(l => ({ id: l.id, passage_id_1: l.passage_id_1, passage_id_2: l.passage_id_2, created_at: l.created_at }));
}

export async function getPassageLinksForPassage(passageId: number): Promise<PassageLink[]> {
  const workspace = await ws();
  return workspace.passage_links
    .filter(l => l.passage_id_1 === passageId || l.passage_id_2 === passageId)
    .map(l => ({ id: l.id, passage_id_1: l.passage_id_1, passage_id_2: l.passage_id_2, created_at: l.created_at }));
}

export async function getPaperLinkDetails(paperId: number): Promise<PassageLinkDetail[]> {
  const workspace = await ws();
  const localAnn = await loadAnnotations(paperId);
  const localMeta = await loadPaperMeta(paperId);
  const localPassageIds = new Set(localAnn.passages.map(p => p.id));

  const relevantLinks = workspace.passage_links.filter(
    l => localPassageIds.has(l.passage_id_1) || localPassageIds.has(l.passage_id_2),
  );
  if (!relevantLinks.length) return [];

  // Find all remote paper IDs we need to load
  const remotePaperIds = new Set<number>();
  for (const link of relevantLinks) {
    const remotePassageId = localPassageIds.has(link.passage_id_1) ? link.passage_id_2 : link.passage_id_1;
    // We need to find which paper this passage belongs to
    for (const pid of workspace.paper_ids) {
      if (pid === paperId) continue;
      remotePaperIds.add(pid);
    }
    void remotePassageId;
  }

  // Build a map of passageId → {text, page, rects, paper_id, paper_title}
  const remotePassageMap = new Map<number, { text: string; page: number; rects: Rect[]; paper_id: number; paper_title: string }>();
  await Promise.all(
    [...remotePaperIds].map(async (rpid) => {
      const [rmeta, rann] = await Promise.all([loadPaperMeta(rpid), loadAnnotations(rpid)]);
      if (!rmeta) return;
      for (const p of rann.passages) {
        remotePassageMap.set(p.id, { text: p.text, page: p.page, rects: p.rects, paper_id: rpid, paper_title: rmeta.title });
      }
    }),
  );

  const details: PassageLinkDetail[] = [];
  for (const link of relevantLinks) {
    const localPassageId = localPassageIds.has(link.passage_id_1) ? link.passage_id_1 : link.passage_id_2;
    const remotePassageId = localPassageId === link.passage_id_1 ? link.passage_id_2 : link.passage_id_1;
    const localPassage = localAnn.passages.find(p => p.id === localPassageId);
    const remotePassage = remotePassageMap.get(remotePassageId);
    if (!localPassage || !remotePassage) continue;
    details.push({
      id: link.id,
      local_passage_id: localPassageId,
      local_passage_text: localPassage.text,
      local_page: localPassage.page,
      remote_passage_id: remotePassageId,
      remote_passage_text: remotePassage.text,
      remote_page: remotePassage.page,
      remote_rects: remotePassage.rects,
      remote_paper_id: remotePassage.paper_id,
      remote_paper_title: remotePassage.paper_title,
      created_at: link.created_at,
    });
  }
  return details;
}

export async function createPassageLink(passageId1: number, passageId2: number): Promise<PassageLink> {
  const workspace = await ws();
  const existing = workspace.passage_links.find(
    l => (l.passage_id_1 === passageId1 && l.passage_id_2 === passageId2) ||
         (l.passage_id_1 === passageId2 && l.passage_id_2 === passageId1),
  );
  if (existing) return existing;
  const link = { id: allocId(workspace), passage_id_1: passageId1, passage_id_2: passageId2, created_at: now() };
  workspace.passage_links.push(link);
  await saveWs();
  return link;
}

export async function deletePassageLink(passageId1: number, passageId2: number): Promise<void> {
  const workspace = await ws();
  workspace.passage_links = workspace.passage_links.filter(
    l => !((l.passage_id_1 === passageId1 && l.passage_id_2 === passageId2) ||
           (l.passage_id_1 === passageId2 && l.passage_id_2 === passageId1)),
  );
  await saveWs();
}

// ---------------------------------------------------------------------------
// Chunk embeddings (for similarity search + Q&A)
// ---------------------------------------------------------------------------

export async function getChunksMeta(paperId: number): Promise<StoredChunksMeta | null> {
  return adapter().readJSON<StoredChunksMeta>(`papers/${paperId}/chunks_meta.json`);
}

export async function getEmbeddingsBin(paperId: number): Promise<ArrayBuffer | null> {
  return adapter().readBinary(`papers/${paperId}/embeddings.bin`);
}

export async function getPassageEmbeddings(paperId: number): Promise<Array<{ id: number; embedding: number[] }>> {
  const ann = await loadAnnotations(paperId);
  return ann.passages
    .filter(p => p.embedding && p.embedding.length > 0)
    .map(p => ({ id: p.id, embedding: p.embedding! }));
}

export async function updatePassageEmbedding(passageId: number, paperId: number, embedding: number[]): Promise<void> {
  const ann = await loadAnnotations(paperId);
  const sp = ann.passages.find(p => p.id === passageId);
  if (sp) {
    sp.embedding = embedding;
    await saveAnnotations(paperId, ann);
  }
}

// ---------------------------------------------------------------------------
// Embedding status + reprocessing
// ---------------------------------------------------------------------------

export async function getPaperEmbeddingStatus(paperId: number): Promise<EmbeddingStatus> {
  const meta = await loadPaperMeta(paperId);
  if (!meta) return 'none';
  const storedModel = meta.embedding_model ?? '';
  if (!storedModel) return 'none';
  const currentModel = getEmbeddingModelId();
  if (!currentModel) return 'stale'; // had embeddings but API is now gone
  return storedModel === currentModel ? 'current' : 'stale';
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let result = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    result += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(result);
}

export async function reprocessEmbeddings(
  paperId: number,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (!hasEmbeddingConfig()) throw new Error('No embedding API configured');

  const [meta, chunksMeta, ann] = await Promise.all([
    loadPaperMeta(paperId),
    getChunksMeta(paperId),
    loadAnnotations(paperId),
  ]);
  if (!meta || !chunksMeta) throw new Error(`Paper ${paperId} not found`);

  const chunkTexts = chunksMeta.chunks.map(c => c.text);
  const passageTexts = ann.passages.map(p => p.text);
  const allTexts = [...chunkTexts, ...passageTexts];

  const allEmbeddings = await embedBatch(allTexts, onProgress);

  const chunkEmbeddings = allEmbeddings.slice(0, chunkTexts.length);
  const passageEmbeddings = allEmbeddings.slice(chunkTexts.length);

  const dim = chunkEmbeddings[0]?.length ?? 0;
  const modelId = getEmbeddingModelId();

  // Write new embeddings.bin
  if (dim > 0 && chunkEmbeddings.length > 0) {
    const flat = new Float32Array(chunkEmbeddings.length * dim);
    for (let i = 0; i < chunkEmbeddings.length; i++) flat.set(chunkEmbeddings[i], i * dim);
    await adapter().writeBinary(`papers/${paperId}/embeddings.bin`, flat.buffer);
  }

  // Update chunks_meta.json
  const newChunksMeta: StoredChunksMeta = {
    embedding_dim: dim,
    embedding_model: modelId,
    chunks: chunksMeta.chunks,
  };
  await adapter().writeJSON(`papers/${paperId}/chunks_meta.json`, newChunksMeta);

  // Update passage embeddings inline
  for (let i = 0; i < ann.passages.length; i++) {
    if (passageEmbeddings[i]) ann.passages[i].embedding = passageEmbeddings[i];
  }
  await saveAnnotations(paperId, ann);

  // Update metadata embedding_model
  meta.embedding_model = modelId;
  await savePaperMeta(meta);

  onProgress?.('Done');
}
