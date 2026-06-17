import { useEffect, useState } from 'react';
import { api, type Project } from '../api';
import { Plus, Trash2, FolderOpen } from 'lucide-react';

interface Props {
  onSelect: (project: Project) => void;
}

export function ProjectsView({ onSelect }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    api.listProjects().then(setProjects);
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const p = await api.createProject(name.trim(), description.trim() || undefined);
    setProjects(prev => [p, ...prev]);
    setName('');
    setDescription('');
    setCreating(false);
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this project?')) return;
    await api.deleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== id));
  };

  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
        >
          <Plus size={16} /> New project
        </button>
      </div>

      {creating && (
        <div className="mb-6 p-4 border border-blue-200 rounded-xl bg-blue-50">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Project name"
            className="w-full mb-2 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full mb-3 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
              Create
            </button>
            <button onClick={() => setCreating(false)} className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {projects.length === 0 && !creating && (
          <p className="text-gray-400 text-center py-12 text-sm">No projects yet. Create one to get started.</p>
        )}
        {projects.map(project => (
          <div
            key={project.id}
            onClick={() => onSelect(project)}
            className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <FolderOpen size={20} className="text-blue-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-gray-800 truncate">{project.name}</p>
                {project.description && (
                  <p className="text-xs text-gray-400 truncate mt-0.5">{project.description}</p>
                )}
              </div>
            </div>
            <button
              onClick={e => handleDelete(project.id, e)}
              className="p-1.5 text-gray-300 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-all"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
