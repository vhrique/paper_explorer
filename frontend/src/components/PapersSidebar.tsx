import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { Paper, Note } from '../api';
import { PDFUploader } from './PDFUploader';
import { EditPaperModal } from './EditPaperModal';
import { FileText, ChevronLeft, ChevronRight, Trash2, Edit2, StickyNote, Plus, Eye, EyeOff } from 'lucide-react';

interface PapersSidebarProps {
    projectId: number;
    onUploadComplete: () => void;
    onEditNote: (note: Note) => void;
    onAddNote: () => void;
    refreshTrigger: number;
    hiddenPaperIds?: Set<number>;
    hiddenNoteIds?: Set<number>;
    onTogglePaperVisibility?: (paperId: number) => void;
    onToggleNoteVisibility?: (noteId: number) => void;
}

export const PapersSidebar: React.FC<PapersSidebarProps> = ({
    projectId,
    onUploadComplete,
    onEditNote,
    onAddNote,
    refreshTrigger,
    hiddenPaperIds,
    hiddenNoteIds,
    onTogglePaperVisibility,
    onToggleNoteVisibility
}) => {
    const [papers, setPapers] = useState<Paper[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [isExpanded, setIsExpanded] = useState(true);
    const [isLoading, setIsLoading] = useState(true);

    // Paper State
    const [editingPaper, setEditingPaper] = useState<Paper | null>(null);

    const loadData = async () => {
        try {
            setIsLoading(true);
            const [papersData, notesData] = await Promise.all([
                api.listPapers(projectId),
                api.listNotes(projectId)
            ]);
            setPapers(papersData);
            setNotes(notesData);
        } catch (error) {
            console.error('Failed to load data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [projectId, refreshTrigger]);

    const handleRefresh = () => {
        loadData();
        onUploadComplete(); // Trigger parent callback (graph refresh)
    };

    // Paper Handlers
    const handleDeletePaper = async (paperId: number, paperTitle: string, e: React.MouseEvent) => {
        e.stopPropagation();

        if (!window.confirm(`Are you sure you want to delete "${paperTitle}"? This will remove all its nodes from the graph.`)) {
            return;
        }

        try {
            await api.deletePaper(paperId);
            handleRefresh();
        } catch (error) {
            console.error('Failed to delete paper:', error);
            alert('Failed to delete paper. Please try again.');
        }
    };

    const handleDeleteNote = async (noteId: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this note?')) return;

        try {
            await api.deleteNote(noteId);
            handleRefresh();
        } catch (error) {
            console.error('Failed to delete note:', error);
            alert('Failed to delete note. Please try again.');
        }
    };

    if (!isExpanded) {
        return (
            <button
                onClick={() => setIsExpanded(true)}
                className="fixed top-24 right-4 z-10 p-3 bg-white rounded-lg shadow-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                title="Show sidebar"
            >
                <ChevronLeft size={20} className="text-gray-600" />
            </button>
        );
    }

    return (
        <div className="fixed top-20 right-4 w-96 max-h-[calc(100vh-14rem)] bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200 z-10 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-800">Project Content</h2>
                <button
                    onClick={() => setIsExpanded(false)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Minimize"
                >
                    <ChevronRight size={20} className="text-gray-600" />
                </button>
            </div>

            {/* Upload Section */}
            <div className="p-4 border-b border-gray-200 bg-gradient-to-br from-blue-50 to-indigo-50">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Upload New Paper</h3>
                <PDFUploader projectId={projectId} onUploadComplete={handleRefresh} />
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">

                {/* Papers Section */}
                <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <FileText size={14} />
                        Papers
                    </h3>
                    {isLoading ? (
                        <div className="text-center text-gray-500 py-4">Loading...</div>
                    ) : papers.length === 0 ? (
                        <div className="text-center text-gray-400 py-4 italic text-sm">
                            No papers uploaded
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {papers.map((paper) => (
                                <div
                                    key={paper.id}
                                    className="group p-3 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all relative"
                                >
                                    <button
                                        onClick={(e) => handleDeletePaper(paper.id, paper.title, e)}
                                        className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        title="Delete paper"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingPaper(paper);
                                        }}
                                        className="absolute top-2 right-9 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        title="Edit paper"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                    {onTogglePaperVisibility && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onTogglePaperVisibility(paper.id);
                                            }}
                                            className={`absolute top-2 right-16 p-1.5 transition-colors opacity-0 group-hover:opacity-100 rounded-lg ${hiddenPaperIds?.has(paper.id)
                                                ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                                : 'text-blue-500 hover:text-blue-600 hover:bg-blue-50'
                                                }`}
                                            title={hiddenPaperIds?.has(paper.id) ? "Show in graph" : "Hide from graph"}
                                        >
                                            {hiddenPaperIds?.has(paper.id) ? (
                                                <EyeOff size={16} />
                                            ) : (
                                                <Eye size={16} />
                                            )}
                                        </button>
                                    )}

                                    <div className="flex items-start gap-3">
                                        <div className="p-2 rounded-lg" style={{ backgroundColor: `${paper.color}20` }}>
                                            <FileText size={20} style={{ color: paper.color }} />
                                        </div>
                                        <div className="flex-1 min-w-0 pr-16">
                                            <h4 className="font-semibold text-sm text-gray-800 truncate">
                                                {paper.title}
                                            </h4>
                                            <p className="text-xs text-gray-500 mt-1">
                                                {new Date(paper.created_at).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Notes Section */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                            <StickyNote size={14} />
                            Notes
                        </h3>
                        <button
                            onClick={onAddNote}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors flex items-center gap-1 text-xs font-medium"
                        >
                            <Plus size={14} />
                            Add Note
                        </button>
                    </div>

                    {notes.length === 0 ? (
                        <div className="text-center text-gray-400 py-4 italic text-sm">
                            No notes added
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {notes.map((note) => (
                                <div
                                    key={note.id}
                                    className="group p-3 rounded-lg border border-gray-200 hover:shadow-sm transition-all relative cursor-pointer"
                                    style={{ backgroundColor: note.color }}
                                    onClick={() => onEditNote(note)}
                                >
                                    <button
                                        onClick={(e) => handleDeleteNote(note.id, e)}
                                        className="absolute top-2 right-2 p-1.5 text-gray-500 hover:text-red-600 hover:bg-white/50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        title="Delete note"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                    {onToggleNoteVisibility && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onToggleNoteVisibility(note.id);
                                            }}
                                            className={`absolute top-2 right-9 p-1.5 transition-colors opacity-0 group-hover:opacity-100 rounded-lg ${hiddenNoteIds?.has(note.id)
                                                ? 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                                                : 'text-blue-500 hover:text-blue-600 hover:bg-white/50'
                                                }`}
                                            title={hiddenNoteIds?.has(note.id) ? "Show in graph" : "Hide from graph"}
                                        >
                                            {hiddenNoteIds?.has(note.id) ? (
                                                <EyeOff size={16} />
                                            ) : (
                                                <Eye size={16} />
                                            )}
                                        </button>
                                    )}

                                    <div className="pr-14">
                                        {note.title && (
                                            <h4 className="font-semibold text-sm text-gray-800 mb-1 truncate">
                                                {note.title}
                                            </h4>
                                        )}
                                        <p className="text-sm text-gray-700 line-clamp-3">
                                            {note.content}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-2">
                                            {new Date(note.created_at).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

            </div>

            {/* Modals */}
            {editingPaper && (
                <EditPaperModal
                    paper={editingPaper}
                    isOpen={true}
                    onClose={() => setEditingPaper(null)}
                    onUpdate={handleRefresh}
                />
            )}
        </div>
    );
};
