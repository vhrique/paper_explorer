import { useEffect, useRef, useState } from 'react';
import { api, type Paper, type Project } from '../api';
import { ArrowLeft, Upload, Trash2, FileText, Plus } from 'lucide-react';

interface Props {
  project: Project;
  onBack: () => void;
  onOpenPaper: (paper: Paper) => void;
}

export function ProjectView({ project, onBack, onOpenPaper }: Props) {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listPapers(project.id).then(setPapers);
  }, [project.id]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const paper = await api.uploadPaper(project.id, file);
      setPapers(prev => [paper, ...prev]);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this paper?')) return;
    await api.deletePaper(id);
    setPapers(prev => prev.filter(p => p.id !== id));
  };

  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-gray-500" />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
      </div>
      {project.description && (
        <p className="text-sm text-gray-400 mb-8 ml-11">{project.description}</p>
      )}

      <div className="flex items-center justify-between mb-6 ml-11">
        <p className="text-sm text-gray-500">{papers.length} paper{papers.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-60"
        >
          {uploading ? (
            <span className="animate-pulse">Uploading…</span>
          ) : (
            <><Plus size={16} /> Add PDF</>
          )}
        </button>
        <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
      </div>

      <div className="space-y-3 ml-11">
        {papers.length === 0 && !uploading && (
          <div
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl py-12 cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all"
          >
            <Upload size={28} className="text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">Drop a PDF or click to upload</p>
          </div>
        )}
        {papers.map(paper => (
          <div
            key={paper.id}
            onClick={() => onOpenPaper(paper)}
            className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <FileText size={18} className="text-red-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-gray-800 truncate">{paper.title}</p>
                {paper.doi && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">DOI: {paper.doi}</p>
                )}
              </div>
            </div>
            <button
              onClick={e => handleDelete(paper.id, e)}
              className="p-1.5 text-gray-300 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
