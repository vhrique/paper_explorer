import React from 'react';
import { X, FileText, Image as ImageIcon } from 'lucide-react';
import { api } from '../api';
import type { Node, Tag } from '../api';

interface DetailPanelProps {
    node: Node | null;
    onClose: () => void;
}

export const DetailPanel: React.FC<DetailPanelProps> = ({ node, onClose }) => {
    if (!node) return null;

    const [tags, setTags] = React.useState<Tag[]>([]);
    const [availableTags, setAvailableTags] = React.useState<Tag[]>([]);
    const [newTagName, setNewTagName] = React.useState('');
    const [isGlobal, setIsGlobal] = React.useState(false);
    const [showAddTag, setShowAddTag] = React.useState(false);

    React.useEffect(() => {
        if (node) {
            loadTags();
            loadAvailableTags();
        }
    }, [node]);

    const loadTags = async () => {
        if (!node) return;
        try {
            const nodeTags = await api.getNodeTags(node.id);
            setTags(nodeTags);
        } catch (error) {
            console.error('Failed to load node tags:', error);
        }
    };

    const loadAvailableTags = async () => {
        if (!node) return;
        try {
            const allTags = await api.listTags(node.paper_id); // Assuming paper_id maps to project_id or we need project_id
            // Wait, node.paper_id is paper id, not project id. We need project_id.
            // The node doesn't have project_id directly. We might need to fetch it or pass it down.
            // For now, let's assume we can get it from the parent or fetch it.
            // Actually, listTags takes project_id. We need to get project_id from somewhere.
            // Let's check where DetailPanel is used.
        } catch (error) {
            console.error('Failed to load available tags:', error);
        }
    };

    return (
        <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl border-l border-gray-200 p-6 overflow-y-auto z-50 transform transition-transform duration-300 ease-in-out">
            <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-2 text-gray-500">
                    {node.type === 'text' ? <FileText size={20} /> : node.type === 'note' ? <FileText size={20} className="text-yellow-600" /> : <ImageIcon size={20} />}
                    <span className="text-sm font-medium uppercase tracking-wider">{node.type} Node</span>
                </div>
                <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={24} />
                </button>
            </div>

            <div className="mb-6">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Source</h3>
                <div className="text-sm text-gray-700">
                    Page {node.page_number}
                </div>
            </div>

            <div className="mb-6">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Tags</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                    {tags.map(tag => (
                        <span key={tag.id} className={`px-2 py-1 rounded-full text-xs font-medium ${tag.type === 'global' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'} flex items-center gap-1`}>
                            {tag.name}
                            <button onClick={async () => {
                                await api.removeNodeTag(node.id, tag.id);
                                loadTags();
                            }} className="hover:text-red-500"><X size={12} /></button>
                        </span>
                    ))}
                </div>

                {showAddTag ? (
                    <div className="bg-gray-50 p-3 rounded-lg">
                        <input
                            type="text"
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            placeholder="Tag name..."
                            className="w-full text-sm border-gray-300 rounded-md mb-2"
                        />
                        <div className="flex items-center gap-2 mb-2">
                            <input
                                type="checkbox"
                                id="isGlobal"
                                checked={isGlobal}
                                onChange={(e) => setIsGlobal(e.target.checked)}
                            />
                            <label htmlFor="isGlobal" className="text-sm text-gray-600">Global Tag</label>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={async () => {
                                    if (!newTagName.trim()) return;
                                    try {
                                        // Check if tag exists in availableTags
                                        let tag = availableTags.find(t => t.name === newTagName && t.type === (isGlobal ? 'global' : 'local'));
                                        if (!tag) {
                                            // Create new tag
                                            // We need project_id for local tags.
                                            // This is a blocker. I need to pass projectId to DetailPanel.
                                        }
                                        if (tag) {
                                            await api.addNodeTag(node.id, tag.id);
                                            loadTags();
                                            setNewTagName('');
                                            setShowAddTag(false);
                                        }
                                    } catch (e) {
                                        console.error(e);
                                    }
                                }}
                                className="px-3 py-1 bg-blue-600 text-white text-xs rounded-md"
                            >
                                Add
                            </button>
                            <button onClick={() => setShowAddTag(false)} className="px-3 py-1 text-gray-500 text-xs">Cancel</button>
                        </div>
                    </div>
                ) : (
                    <button onClick={() => setShowAddTag(true)} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                        + Add Tag
                    </button>
                )}
            </div>

            <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Content</h3>
                {node.type === 'text' ? (
                    <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                        {node.content}
                    </p>
                ) : node.type === 'note' ? (
                    <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                        <h4 className="font-bold text-gray-800 mb-2">{node.title || 'Untitled Note'}</h4>
                        <p className="text-gray-800 whitespace-pre-wrap">{node.content}</p>
                    </div>
                ) : (
                    <div className="rounded-lg overflow-hidden border border-gray-200">
                        <img
                            src={`http://localhost:8000/static/images/${node.content}`}
                            alt="Node content"
                            className="w-full h-auto"
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
