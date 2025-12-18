import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { Project } from '../api';
import { Plus, FolderOpen, Trash2, Edit2 } from 'lucide-react';
import EditProjectModal from './EditProjectModal';

interface ProjectListProps {
    onSelectProject: (project: Project) => void;
}

export const ProjectList: React.FC<ProjectListProps> = ({ onSelectProject }) => {
    const [projects, setProjects] = useState<Project[]>([]);
    const [newProjectName, setNewProjectName] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [editingProject, setEditingProject] = useState<Project | null>(null);

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const data = await api.listProjects();
            setProjects(data);
        } catch (error) {
            console.error("Failed to load projects", error);
            setError("Failed to connect to backend. Is the server running on port 8000?");
            setProjects([]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) return;
        try {
            const project = await api.createProject(newProjectName, '');
            setProjects([project, ...projects]);
            setNewProjectName('');
            setIsCreating(false);
        } catch (error) {
            console.error("Failed to create project", error);
        }
    };

    const handleDeleteProject = async (projectId: number, projectName: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent opening the project

        if (!window.confirm(`Are you sure you want to delete "${projectName}"? This cannot be undone.`)) {
            return;
        }

        try {
            await api.deleteProject(projectId);
            setProjects(projects.filter(p => p.id !== projectId));
        } catch (error) {
            console.error("Failed to delete project", error);
            alert("Failed to delete project. Please try again.");
        }
    };

    const handleEditProject = (project: Project, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingProject(project);
    };

    const handleProjectUpdated = (updatedProject: Project) => {
        setProjects(projects.map(p => p.id === updatedProject.id ? updatedProject : p));
        setEditingProject(null);
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold text-gray-800">My Projects</h1>
                <button
                    onClick={() => setIsCreating(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <Plus size={20} />
                    New Project
                </button>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                    {error}
                </div>
            )}

            {isLoading && !error && (
                <div className="text-center py-12 text-gray-500">
                    Loading projects...
                </div>
            )}

            {isCreating && (
                <div className="mb-8 p-6 bg-white rounded-xl shadow-sm border border-gray-100">
                    <h2 className="text-lg font-semibold mb-4">Create New Project</h2>
                    <div className="flex gap-4">
                        <input
                            type="text"
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder="Project Name"
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                        <button
                            onClick={handleCreateProject}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                            Create
                        </button>
                        <button
                            onClick={() => setIsCreating(false)}
                            className="px-6 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map((project) => (
                    <div
                        key={project.id}
                        onClick={() => onSelectProject(project)}
                        className="group p-6 bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-all cursor-pointer hover:border-blue-200 relative"
                    >
                        <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                                onClick={(e) => handleEditProject(project, e)}
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Edit project"
                            >
                                <Edit2 size={18} />
                            </button>
                            <button
                                onClick={(e) => handleDeleteProject(project.id, project.name, e)}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete project"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>

                        <div className="flex items-start justify-between mb-4">
                            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-100 transition-colors">
                                <FolderOpen size={24} />
                            </div>
                            <span className="text-xs text-gray-400">
                                {new Date(project.created_at).toLocaleDateString()}
                            </span>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-800 mb-2 pr-16">{project.name}</h3>
                        <p className="text-sm text-gray-500 line-clamp-2">
                            {project.description || "No description"}
                        </p>
                    </div>
                ))}
            </div>

            {editingProject && (
                <EditProjectModal
                    isOpen={!!editingProject}
                    onClose={() => setEditingProject(null)}
                    onSave={handleProjectUpdated}
                    project={editingProject}
                />
            )}
        </div>
    );
};
