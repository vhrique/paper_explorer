import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || '/api';

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

export const api = {
  // Projects
  listProjects: () => axios.get<Project[]>(`${BASE}/projects`).then(r => r.data),
  createProject: (name: string, description?: string) =>
    axios.post<Project>(`${BASE}/projects`, { name, description }).then(r => r.data),
  updateProject: (id: number, data: Partial<Project>) =>
    axios.patch<Project>(`${BASE}/projects/${id}`, data).then(r => r.data),
  deleteProject: (id: number) => axios.delete(`${BASE}/projects/${id}`),

  // Papers
  listAllPapers: () =>
    axios.get<Paper[]>(`${BASE}/papers`).then(r => r.data),
  listPapers: (projectId: number) =>
    axios.get<Paper[]>(`${BASE}/projects/${projectId}/papers`).then(r => r.data),
  getPaper: (id: number) => axios.get<Paper>(`${BASE}/papers/${id}`).then(r => r.data),
  uploadPaper: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return axios.post<Paper>(`${BASE}/papers`, form).then(r => r.data);
  },
  updatePaper: (id: number, data: Partial<Paper>) =>
    axios.patch<Paper>(`${BASE}/papers/${id}`, data).then(r => r.data),
  deletePaper: (id: number) => axios.delete(`${BASE}/papers/${id}`),
  addPaperToProject: (paperId: number, projectId: number) =>
    axios.post(`${BASE}/papers/${paperId}/projects/${projectId}`),
  removePaperFromProject: (paperId: number, projectId: number) =>
    axios.delete(`${BASE}/papers/${paperId}/projects/${projectId}`),
  getPaperPdfUrl: (id: number) => `${BASE}/papers/${id}/pdf`,

  // Passages
  listPassages: (paperId: number) =>
    axios.get<Passage[]>(`${BASE}/papers/${paperId}/passages`).then(r => r.data),
  createPassage: (paperId: number, data: { page: number; text: string; rects: Rect[]; color?: string }) =>
    axios.post<Passage>(`${BASE}/papers/${paperId}/passages`, data).then(r => r.data),
  updatePassage: (id: number, data: { color?: string }) =>
    axios.patch<Passage>(`${BASE}/passages/${id}`, data).then(r => r.data),
  deletePassage: (id: number) => axios.delete(`${BASE}/passages/${id}`),
  getSimilarPassages: (id: number, limit = 10) =>
    axios.get<SimilarPassage[]>(`${BASE}/passages/${id}/similar`, { params: { limit } }).then(r => r.data),
  getPassageLinks: (id: number) =>
    axios.get<PassageLink[]>(`${BASE}/passages/${id}/links`).then(r => r.data),
  getPaperLinks: (paperId: number) =>
    axios.get<PassageLinkDetail[]>(`${BASE}/papers/${paperId}/links`).then(r => r.data),
  createPassageLink: (id: number, otherId: number) =>
    axios.post<PassageLink>(`${BASE}/passages/${id}/links/${otherId}`).then(r => r.data),
  deletePassageLink: (id: number, otherId: number) =>
    axios.delete(`${BASE}/passages/${id}/links/${otherId}`),

  // Tags
  listTags: (projectId: number) =>
    axios.get<Tag[]>(`${BASE}/projects/${projectId}/tags`).then(r => r.data),
  createTag: (name: string, type: 'content' | 'paper', projectId?: number) =>
    axios.post<Tag>(`${BASE}/tags`, { name, type, project_id: projectId }).then(r => r.data),
  updateTag: (id: number, name: string) =>
    axios.patch<Tag>(`${BASE}/tags/${id}`, { name }).then(r => r.data),
  deleteTag: (id: number) => axios.delete(`${BASE}/tags/${id}`),
  addPassageTag: (passageId: number, tagId: number) =>
    axios.post(`${BASE}/passages/${passageId}/tags/${tagId}`),
  removePassageTag: (passageId: number, tagId: number) =>
    axios.delete(`${BASE}/passages/${passageId}/tags/${tagId}`),
  getTagPassages: (tagId: number) =>
    axios.get<Passage[]>(`${BASE}/tags/${tagId}/passages`).then(r => r.data),

  // Notes
  createNote: (data: { type: 'passage' | 'tag'; content: string; passage_ids?: number[]; tag_ids?: number[] }) =>
    axios.post<Note>(`${BASE}/notes`, data).then(r => r.data),
  getPassageNotes: (passageId: number) =>
    axios.get<Note[]>(`${BASE}/passages/${passageId}/notes`).then(r => r.data),
  getTagNotes: (tagId: number) =>
    axios.get<Note[]>(`${BASE}/tags/${tagId}/notes`).then(r => r.data),
  updateNote: (id: number, content: string) =>
    axios.patch<Note>(`${BASE}/notes/${id}`, { content }).then(r => r.data),
  deleteNote: (id: number) => axios.delete(`${BASE}/notes/${id}`),

  // Q&A
  searchPaper: (paperId: number, query: string, limit = 10) =>
    axios.post<SearchResponse>(`${BASE}/papers/${paperId}/search`, { query, limit }).then(r => r.data),
};
