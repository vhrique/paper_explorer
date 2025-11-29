import React, { useState, useEffect } from 'react';
import type { Note, Node } from '../api';
import { SimilarityModal } from './SimilarityModal';
import { Search } from 'lucide-react';

interface NoteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (title: string, content: string, color: string) => Promise<void>;
    initialNote?: Note | null;
    onViewNode?: (node: Node) => void;
}

const COLORS = [
    "#FEF3C7", // Yellow
    "#BFDBFE", // Blue
    "#BBF7D0", // Green
    "#FECACA", // Red
    "#DDD6FE", // Purple
    "#FBCFE8", // Pink
];

const NoteModal: React.FC<NoteModalProps> = ({ isOpen, onClose, onSave, initialNote, onViewNode }) => {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [color, setColor] = useState(COLORS[0]);
    const [isSaving, setIsSaving] = useState(false);
    const [showSimilarity, setShowSimilarity] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (initialNote) {
                setTitle(initialNote.title || '');
                setContent(initialNote.content);
                setColor(initialNote.color);
            } else {
                setTitle('');
                setContent('');
                setColor(COLORS[0]);
            }
        }
    }, [isOpen, initialNote]);

    const handleSave = async () => {
        if (!content.trim()) return;

        setIsSaving(true);
        try {
            await onSave(title, content, color);
            onClose();
        } catch (error) {
            console.error("Failed to save note:", error);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 bg-black bg-opacity-10 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" style={{ backgroundColor: color }}>
                <h2 className="text-xl font-bold mb-4 text-gray-800">
                    {initialNote ? 'Edit Note' : 'New Note'}
                </h2>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Title (Optional)</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white bg-opacity-50"
                            placeholder="Note Title"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[150px] bg-white bg-opacity-50"
                            placeholder="Write your note here..."
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
                        <div className="flex space-x-2">
                            {COLORS.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setColor(c)}
                                    className={`w-8 h-8 rounded-full border-2 ${color === c ? 'border-gray-600' : 'border-transparent'}`}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-between items-center">
                    <div>
                        {initialNote && (
                            <button
                                onClick={() => setShowSimilarity(true)}
                                className="px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors flex items-center gap-2 text-sm font-medium"
                            >
                                <Search size={16} />
                                Find Similar
                            </button>
                        )}
                    </div>
                    <div className="flex space-x-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                            disabled={isSaving}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                            disabled={isSaving || !content.trim()}
                        >
                            {isSaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>

            {initialNote && (
                <SimilarityModal
                    isOpen={showSimilarity}
                    onClose={() => setShowSimilarity(false)}
                    noteId={initialNote.id}
                    onViewNode={(node) => {
                        if (onViewNode) {
                            onViewNode(node);
                            // Don't close modals to allow continuous browsing
                        }
                    }}
                />
            )}
        </div>
    );
};

export default NoteModal;
