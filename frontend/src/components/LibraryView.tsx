import { useEffect, useRef, useState } from 'react';
import { api, type Paper, type Project } from '../api';
import { FileText, Plus, Trash2, Upload, X } from 'lucide-react';

interface Props {
  onOpenPaper: (paper: Paper, project: Project) => void;
}

export function LibraryView({ onOpenPaper }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allPapers, setAllPapers] = useState<Paper[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [openAddMenuPaperId, setOpenAddMenuPaperId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listProjects().then(setProjects);
    api.listAllPapers().then(p => { setAllPapers(p); setPapers(p); });
  }, []);

  useEffect(() => {
    if (!openAddMenuPaperId) return;
    const close = () => setOpenAddMenuPaperId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openAddMenuPaperId]);

  useEffect(() => {
    if (selectedProjectId === null) {
      api.listAllPapers().then(p => { setAllPapers(p); setPapers(p); });
    } else {
      api.listPapers(selectedProjectId).then(setPapers);
    }
  }, [selectedProjectId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const paper = await api.uploadPaper(file);
      setAllPapers(prev => [paper, ...prev]);
      if (selectedProjectId === null) setPapers(prev => [paper, ...prev]);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    const p = await api.createProject(newProjectName.trim());
    setProjects(prev => [...prev, p]);
    setNewProjectName('');
    setCreatingProject(false);
  };

  const handleDeleteProject = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this project? Papers will not be deleted.')) return;
    await api.deleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (selectedProjectId === id) setSelectedProjectId(null);
  };

  const handleDeletePaper = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this paper?')) return;
    await api.deletePaper(id);
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
    await api.addPaperToProject(paper.id, projectId);
    const updated = { ...paper, project_ids: [...paper.project_ids, projectId] };
    setAllPapers(prev => prev.map(p => p.id === paper.id ? updated : p));
    setPapers(prev => prev.map(p => p.id === paper.id ? updated : p));
  };

  const handleRemoveFromProject = async (paper: Paper, projectId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.removePaperFromProject(paper.id, projectId);
    const updated = { ...paper, project_ids: paper.project_ids.filter(id => id !== projectId) };
    setAllPapers(prev => prev.map(p => p.id === paper.id ? updated : p));
    setPapers(prev => prev.map(p => p.id === paper.id ? updated : p));
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

        <div className="p-3 border-t border-gray-100">
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
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">
              {selectedProjectId ? projects.find(p => p.id === selectedProjectId)?.name : 'All papers'}
            </h2>
            <p className="text-xs text-gray-400">{papers.length} paper{papers.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
          >
            {uploading ? <span className="animate-pulse">Uploading…</span> : <><Upload size={15} /> Add paper</>}
          </button>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
        </div>

        {/* Paper list */}
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
                return (
                  <div
                    key={paper.id}
                    onClick={() => canOpen && handleOpenPaper(paper)}
                    title={canOpen ? undefined : 'Assign to a project to open'}
                    className={`flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl transition-all group ${
                      canOpen ? 'hover:border-blue-300 hover:shadow-sm cursor-pointer' : 'opacity-60 cursor-default'
                    }`}
                  >
                    <FileText size={18} className="text-red-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-800 truncate">{paper.title}</p>
                      <div className="flex items-center flex-wrap gap-1.5 mt-1.5" onClick={e => e.stopPropagation()}>
                        {paper.doi && (
                          <span className="text-xs text-gray-400 mr-1">DOI: {paper.doi}</span>
                        )}
                        {paper.project_ids.map(pid => {
                          const proj = projects.find(p => p.id === pid);
                          return proj ? (
                            <span key={pid} className="flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
                              {proj.name}
                              <button
                                onClick={e => handleRemoveFromProject(paper, pid, e)}
                                className="text-blue-300 hover:text-blue-600 transition-colors"
                                title="Remove from project"
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
    </div>
  );
}
