import { useEffect, useRef, useState } from 'react';
import { api, type Paper, type PaperMetadataResult, type Project } from '../api';
import * as ws from '../storage/workspace';
import type { EmbeddingStatus } from '../storage/types';
import { hasEmbeddingConfig } from '../services/settingsService';
import { clearChunkCache } from '../utils/similarity';
import { FileText, Pencil, Plus, RefreshCw, Settings, Trash2, Upload, X, Zap } from 'lucide-react';

interface Props {
  onOpenPaper: (paper: Paper, project: Project) => void;
  onOpenSettings?: () => void;
}

export function LibraryView({ onOpenPaper, onOpenSettings }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allPapers, setAllPapers] = useState<Paper[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [openAddMenuPaperId, setOpenAddMenuPaperId] = useState<number | null>(null);
  const [editingPaper, setEditingPaper] = useState<Paper | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDoi, setEditDoi] = useState('');
  const [editArxivId, setEditArxivId] = useState('');
  const [editAbstract, setEditAbstract] = useState('');
  const [fetchedMeta, setFetchedMeta] = useState<PaperMetadataResult | null>(null);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [savingPaper, setSavingPaper] = useState(false);
  const [embStatuses, setEmbStatuses] = useState<Map<number, EmbeddingStatus>>(new Map());
  const [reprocessingId, setReprocessingId] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const [projs, all] = await Promise.all([ws.getProjects(), ws.getAllPapers()]);
    setProjects(projs);
    setAllPapers(all);
    const visible = selectedProjectId == null ? all : all.filter(p => p.project_ids.includes(selectedProjectId));
    setPapers(visible);
    loadEmbStatuses(visible);
  };

  const loadEmbStatuses = async (paperList: Paper[]) => {
    const entries = await Promise.all(
      paperList.map(async p => [p.id, await ws.getPaperEmbeddingStatus(p.id)] as [number, EmbeddingStatus]),
    );
    setEmbStatuses(new Map(entries));
  };

  const handleReprocess = async (paperId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setReprocessingId(paperId);
    try {
      await ws.reprocessEmbeddings(paperId);
      clearChunkCache(paperId);
      const newStatus = await ws.getPaperEmbeddingStatus(paperId);
      setEmbStatuses(prev => new Map(prev).set(paperId, newStatus));
    } catch (err) {
      alert(`Reprocess failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setReprocessingId(null);
    }
  };

  const handleBatchReprocess = async () => {
    const needsUpdate = papers.filter(p => {
      const s = embStatuses.get(p.id);
      return s === 'none' || s === 'stale';
    });
    if (!needsUpdate.length) return;

    // Pre-count total texts (chunks + passages) across all papers
    const counts = await Promise.all(
      needsUpdate.map(async p => {
        const [meta, passages] = await Promise.all([ws.getChunksMeta(p.id), ws.getPassages(p.id)]);
        return (meta?.chunks.length ?? 0) + passages.length;
      }),
    );
    const totalTexts = counts.reduce((a, b) => a + b, 0);
    let doneTexts = 0;
    setBatchProgress({ done: 0, total: totalTexts });

    for (let i = 0; i < needsUpdate.length; i++) {
      const p = needsUpdate[i];
      try {
        await ws.reprocessEmbeddings(p.id, (paperDone) => {
          setBatchProgress({ done: doneTexts + paperDone, total: totalTexts });
        });
        doneTexts += counts[i];
        clearChunkCache(p.id);
        const newStatus = await ws.getPaperEmbeddingStatus(p.id);
        setEmbStatuses(prev => new Map(prev).set(p.id, newStatus));
      } catch {
        doneTexts += counts[i]; // skip failed paper's count
      }
      setBatchProgress({ done: doneTexts, total: totalTexts });
    }
    setBatchProgress(null);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!openAddMenuPaperId) return;
    const close = () => setOpenAddMenuPaperId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openAddMenuPaperId]);

  useEffect(() => {
    ws.getAllPapers().then(all => {
      setAllPapers(all);
      const visible = selectedProjectId == null ? all : all.filter(p => p.project_ids.includes(selectedProjectId));
      setPapers(visible);
      loadEmbStatuses(visible);
    });
  }, [selectedProjectId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.processPaper(file);
      const paper = await ws.registerPaper(result, file, selectedProjectId ?? undefined);
      setAllPapers(prev => [paper, ...prev]);
      setPapers(prev => {
        const next = [paper, ...prev];
        loadEmbStatuses(next);
        return next;
      });
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    const p = await ws.createProject(newProjectName.trim());
    setProjects(prev => [...prev, p]);
    setNewProjectName('');
    setCreatingProject(false);
  };

  const handleDeleteProject = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this project? Papers will not be deleted.')) return;
    await ws.deleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (selectedProjectId === id) setSelectedProjectId(null);
  };

  const handleDeletePaper = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this paper?')) return;
    await ws.deletePaper(id);
    setAllPapers(prev => prev.filter(p => p.id !== id));
    setPapers(prev => prev.filter(p => p.id !== id));
  };

  const handleOpenPaper = (paper: Paper) => {
    const projectId = selectedProjectId ?? paper.project_ids[0];
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    onOpenPaper(paper, project);
  };

  const handleAddToProject = async (paper: Paper, projectId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await ws.addPaperToProject(paper.id, projectId);
    const updated = { ...paper, project_ids: [...paper.project_ids, projectId] };
    setAllPapers(prev => prev.map(p => p.id === paper.id ? updated : p));
    setPapers(prev => prev.map(p => p.id === paper.id ? updated : p));
  };

  const handleRemoveFromProject = async (paper: Paper, projectId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await ws.removePaperFromProject(paper.id, projectId);
    const updated = { ...paper, project_ids: paper.project_ids.filter(id => id !== projectId) };
    setAllPapers(prev => prev.map(p => p.id === paper.id ? updated : p));
    setPapers(prev => prev.map(p => p.id === paper.id ? updated : p));
  };

  const handleEditPaper = (paper: Paper, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPaper(paper);
    setEditTitle(paper.title);
    setEditDoi(paper.doi || '');
    setEditArxivId(paper.arxiv_id || '');
    setEditAbstract(paper.abstract || '');
    setFetchedMeta(null);
  };

  const handleFetchMetadata = async () => {
    if (!editingPaper) return;
    setFetchingMeta(true);
    try {
      const meta = await api.fetchMetadata(editDoi || undefined, editArxivId || undefined, editTitle || undefined);
      setFetchedMeta(meta);
      if (meta.title) setEditTitle(meta.title);
      if (meta.doi) setEditDoi(meta.doi);
      if (meta.abstract) setEditAbstract(meta.abstract);
    } catch {
      alert('No metadata found. Try correcting the DOI or title and fetch again.');
    } finally {
      setFetchingMeta(false);
    }
  };

  const handleSavePaperInfo = async () => {
    if (!editingPaper) return;
    setSavingPaper(true);
    try {
      const updated = await ws.updatePaperMetadata(editingPaper.id, {
        title: editTitle || editingPaper.title,
        doi: editDoi || undefined,
        arxiv_id: editArxivId || undefined,
        abstract: editAbstract || undefined,
      });
      setAllPapers(prev => prev.map(p => p.id === updated.id ? updated : p));
      setPapers(prev => prev.map(p => p.id === updated.id ? updated : p));
      setEditingPaper(null);
    } finally {
      setSavingPaper(false);
    }
  };

  const paperCount = (projectId: number) =>
    allPapers.filter(p => p.project_ids.includes(projectId)).length;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-100">
          <h1 className="text-base font-bold text-gray-900 tracking-tight">Paper Explorer</h1>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          <button
            onClick={() => setSelectedProjectId(null)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors mb-1 ${
              selectedProjectId === null ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span>All papers</span>
            <span className="text-xs text-gray-400">{allPapers.length || ''}</span>
          </button>

          {projects.length > 0 && (
            <p className="text-xs text-gray-400 px-3 pt-3 pb-1 uppercase tracking-wider">Projects</p>
          )}

          {projects.map(project => (
            <div key={project.id} className="group relative">
              <button
                onClick={() => setSelectedProjectId(project.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedProjectId === project.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span className="truncate text-left">{project.name}</span>
                <span className="text-xs text-gray-400 ml-1 flex-shrink-0">{paperCount(project.id) || ''}</span>
              </button>
              <button
                onClick={e => handleDeleteProject(project.id, e)}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-100 space-y-1">
          {creatingProject ? (
            <div className="flex gap-1.5">
              <input
                autoFocus
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateProject(); if (e.key === 'Escape') setCreatingProject(false); }}
                placeholder="Project name"
                className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button onClick={handleCreateProject} className="px-2 py-1.5 bg-blue-600 text-white text-xs rounded-lg">Add</button>
              <button onClick={() => setCreatingProject(false)} className="p-1.5 text-gray-400 hover:text-gray-600"><X size={13} /></button>
            </div>
          ) : (
            <button
              onClick={() => setCreatingProject(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Plus size={13} /> New project
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <Settings size={13} /> Settings
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">
              {selectedProjectId ? projects.find(p => p.id === selectedProjectId)?.name : 'All papers'}
            </h2>
            <p className="text-xs text-gray-400">{papers.length} paper{papers.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {hasEmbeddingConfig() && (batchProgress || papers.some(p => { const s = embStatuses.get(p.id); return s === 'none' || s === 'stale'; })) && (
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={handleBatchReprocess}
                  disabled={!!batchProgress}
                  className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-sm hover:bg-amber-100 transition-colors disabled:opacity-50"
                >
                  <Zap size={14} className={batchProgress ? 'animate-pulse' : ''} />
                  {batchProgress ? `${batchProgress.done} / ${batchProgress.total}` : 'Update all'}
                </button>
                {batchProgress && (
                  <div className="w-full h-1 bg-amber-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full transition-all duration-300"
                      style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
            >
              {uploading ? <span className="animate-pulse">Processing…</span> : <><Upload size={15} /> Add paper</>}
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {papers.length === 0 ? (
            <div
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl py-20 cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all"
            >
              <Upload size={32} className="text-gray-300 mb-3" />
              <p className="text-sm text-gray-400">Click to add your first paper</p>
            </div>
          ) : (
            <div className="space-y-2">
              {papers.map(paper => {
                const canOpen = paper.project_ids.length > 0;
                const embStatus = embStatuses.get(paper.id);
                const isReprocessing = reprocessingId === paper.id;
                return (
                  <div
                    key={paper.id}
                    onClick={() => canOpen && handleOpenPaper(paper)}
                    className={`flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl transition-all group ${
                      canOpen ? 'hover:border-blue-300 hover:shadow-sm cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <FileText size={18} className="text-red-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className={`font-medium truncate ${canOpen ? 'text-gray-800' : 'text-gray-400'}`}>{paper.title}</p>
                      {!canOpen && (
                        <p className="text-xs text-amber-500 mt-0.5">Add to a project to open</p>
                      )}
                      <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                        {paper.doi && <span className="text-xs text-gray-400 mr-1">DOI: {paper.doi}</span>}
                        {paper.arxiv_id && <span className="text-xs text-gray-400 mr-1">arXiv: {paper.arxiv_id}</span>}
                        {/* Embedding status badge */}
                        {embStatus === 'current' && (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" /> Embedded
                          </span>
                        )}
                        {embStatus === 'stale' && (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full border border-amber-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" /> Stale model
                          </span>
                        )}
                        {embStatus === 'none' && hasEmbeddingConfig() && (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-50 text-gray-400 rounded-full border border-gray-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" /> No embeddings
                          </span>
                        )}
                        {paper.project_ids.map(pid => {
                          const proj = projects.find(p => p.id === pid);
                          return proj ? (
                            <span key={pid} className="flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
                              {proj.name}
                              <button
                                onClick={e => handleRemoveFromProject(paper, pid, e)}
                                className="text-blue-300 hover:text-blue-600 transition-colors"
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ) : null;
                        })}
                        {projects.some(p => !paper.project_ids.includes(p.id)) && (
                          <div className="relative">
                            <button
                              onClick={e => { e.stopPropagation(); setOpenAddMenuPaperId(openAddMenuPaperId === paper.id ? null : paper.id); }}
                              className="flex items-center gap-0.5 text-xs px-2 py-0.5 border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 rounded-full transition-colors"
                            >
                              <Plus size={10} /> project
                            </button>
                            {openAddMenuPaperId === paper.id && (
                              <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10 min-w-[120px]">
                                {projects.filter(p => !paper.project_ids.includes(p.id)).map(p => (
                                  <button
                                    key={p.id}
                                    onClick={e => { handleAddToProject(paper, p.id, e); setOpenAddMenuPaperId(null); }}
                                    className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-600"
                                  >
                                    {p.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Reprocess button for stale/none papers when API is configured */}
                    {hasEmbeddingConfig() && (embStatus === 'none' || embStatus === 'stale') && (
                      <button
                        onClick={e => handleReprocess(paper.id, e)}
                        disabled={isReprocessing}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-amber-600 border border-amber-200 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50 flex-shrink-0 opacity-0 group-hover:opacity-100"
                        title={embStatus === 'stale' ? 'Update embeddings to current model' : 'Generate embeddings'}
                      >
                        <Zap size={11} className={isReprocessing ? 'animate-pulse' : ''} />
                        {isReprocessing ? '…' : embStatus === 'stale' ? 'Update' : 'Generate'}
                      </button>
                    )}
                    <button
                      onClick={e => handleEditPaper(paper, e)}
                      className="p-1.5 text-gray-300 hover:text-blue-500 rounded opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={e => handleDeletePaper(paper.id, e)}
                      className="p-1.5 text-gray-300 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {editingPaper && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingPaper(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Paper Info</h3>
              <button onClick={() => setEditingPaper(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">DOI</label>
                <div className="flex gap-2">
                  <input value={editDoi} onChange={e => setEditDoi(e.target.value)} placeholder="10.xxxx/xxxxx"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <button onClick={handleFetchMetadata} disabled={fetchingMeta}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 bg-gray-50 rounded-lg hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors disabled:opacity-50">
                    <RefreshCw size={13} className={fetchingMeta ? 'animate-spin' : ''} /> Fetch
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">arXiv ID</label>
                <div className="flex gap-2">
                  <input value={editArxivId} onChange={e => setEditArxivId(e.target.value)} placeholder="2301.07041"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  {!editDoi && (
                    <button onClick={handleFetchMetadata} disabled={fetchingMeta}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 bg-gray-50 rounded-lg hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors disabled:opacity-50">
                      <RefreshCw size={13} className={fetchingMeta ? 'animate-spin' : ''} /> Fetch
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Abstract</label>
                <textarea value={editAbstract} onChange={e => setEditAbstract(e.target.value)} rows={5}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none" />
              </div>
              {fetchedMeta && (
                <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-600 space-y-1">
                  {fetchedMeta.authors && fetchedMeta.authors.length > 0 && (
                    <p><span className="font-medium">Authors: </span>
                      {fetchedMeta.authors.slice(0, 5).join(', ')}
                      {fetchedMeta.authors.length > 5 ? ` +${fetchedMeta.authors.length - 5} more` : ''}
                    </p>
                  )}
                  {fetchedMeta.year && <p><span className="font-medium">Year: </span>{fetchedMeta.year}</p>}
                  {fetchedMeta.venue && <p><span className="font-medium">Venue: </span>{fetchedMeta.venue}</p>}
                  <p className="text-gray-400 pt-0.5">
                    Source: {fetchedMeta.source === 'semantic_scholar' ? 'Semantic Scholar' : 'OpenAlex'}
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setEditingPaper(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">Cancel</button>
              <button onClick={handleSavePaperInfo} disabled={savingPaper}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
                {savingPaper ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
