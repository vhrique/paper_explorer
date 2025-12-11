import React, { useState, useEffect } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { api } from '../api';

interface Paper {
    id: number;
    title: string;
    description?: string;
    doi?: string;
    color: string;
}

interface EditPaperModalProps {
    paper: Paper;
    isOpen: boolean;
    onClose: () => void;
    onUpdate: () => void;
}

const COLORS = [
    "#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6",
    "#EC4899", "#14B8A6", "#F97316", "#06B6D4", "#6366F1"
];

export const EditPaperModal: React.FC<EditPaperModalProps> = ({ paper, isOpen, onClose, onUpdate }) => {
    const [title, setTitle] = useState(paper.title);
    const [description, setDescription] = useState(paper.description || '');
    const [doi, setDoi] = useState(paper.doi || '');
    const [color, setColor] = useState(paper.color);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setTitle(paper.title);
            setDescription(paper.description || '');
            setDoi(paper.doi || '');
            setColor(paper.color);
            setError(null);
        }
    }, [isOpen, paper]);

    if (!isOpen) return null;

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            await api.updatePaper(paper.id, { title, description, color, doi });
            onUpdate();
            onClose();
        } catch (err) {
            console.error(err);
            setError('Failed to update paper. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Edit Paper</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            placeholder="Paper Title"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all min-h-[80px]"
                            placeholder="Add a description..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">DOI</label>
                        <input
                            type="text"
                            value={doi}
                            onChange={(e) => setDoi(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                            placeholder="10.xxxx/xxxxx"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
                        <div className="flex flex-wrap gap-2">
                            {COLORS.map((c) => (
                                <button
                                    key={c}
                                    onClick={() => setColor(c)}
                                    className={`w-8 h-8 rounded-full transition-all ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'
                                        }`}
                                    style={{ backgroundColor: c }}
                                    aria-label={`Select color ${c}`}
                                />
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                            {error}
                        </div>
                    )}
                </div>

                <div className="p-4 bg-gray-50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 size={18} className="animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save size={18} />
                                Save Changes
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
