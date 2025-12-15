import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { TagSummary, Tag } from '../api';
import { Tag as TagIcon, ChevronRight, ChevronDown, Trash2, Edit2, X, Check, Eye, EyeOff } from 'lucide-react';

interface TagsPanelProps {
    projectId: number;
    projectId: number;
    onNodeClick: (node: any) => void;
    hiddenTagNames?: Set<string>;
    onToggleTagVisibility?: (tagName: string) => void;
}

interface TaggedNode {
    node_id: string;
    content: string;
    page_number: number;
    paper_id: number;
    paper_color: string;
    tagged_at: string;
    bbox: number[];
}

export const TagsPanel: React.FC<TagsPanelProps> = ({ projectId, onNodeClick, hiddenTagNames, onToggleTagVisibility }) => {
    const [tags, setTags] = useState<TagSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedTagId, setExpandedTagId] = useState<number | null>(null);
    const [tagNodes, setTagNodes] = useState<TaggedNode[]>([]);
    const [isLoadingNodes, setIsLoadingNodes] = useState(false);
    const [editingTagId, setEditingTagId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [isExpanded, setIsExpanded] = useState(false); // Panel expansion state

    const loadTags = async () => {
        try {
            setIsLoading(true);
            const data = await api.getTagSummary(projectId);
            // Filter tags that have at least one node
            const activeTags = data.filter(t => t.node_count > 0);
            setTags(activeTags);
        } catch (error) {
            console.error('Failed to load tags:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadTags();
    }, [projectId]);

    const handleExpandTag = async (tagId: number) => {
        if (expandedTagId === tagId) {
            setExpandedTagId(null);
            setTagNodes([]);
            return;
        }

        setExpandedTagId(tagId);
        try {
            setIsLoadingNodes(true);
            const nodes = await api.getTagNodes(projectId, tagId);
            setTagNodes(nodes);
        } catch (error) {
            console.error('Failed to load tag nodes:', error);
        } finally {
            setIsLoadingNodes(false);
        }
    };

    const handleDeleteTag = async (tagId: number) => {
        if (!confirm('Are you sure you want to delete this tag? This will remove it from all nodes.')) {
            return;
        }

        try {
            await api.deleteTag(tagId);
            loadTags();
            if (expandedTagId === tagId) {
                setExpandedTagId(null);
            }
        } catch (error) {
            console.error('Failed to delete tag:', error);
            alert('Failed to delete tag');
        }
    };

    const startEditing = (tag: TagSummary) => {
        setEditingTagId(tag.tag_id);
        setEditName(tag.tag_name);
    };

    const cancelEditing = () => {
        setEditingTagId(null);
        setEditName('');
    };

    const saveTagRename = async (tagId: number) => {
        if (!editName.trim()) return;

        try {
            await api.updateTag(tagId, editName.trim());
            setEditingTagId(null);
            loadTags();
        } catch (error) {
            console.error('Failed to rename tag:', error);
            alert('Failed to rename tag');
        }
    };

    if (!isExpanded) {
        return (
            <button
                onClick={() => setIsExpanded(true)}
                className="fixed bottom-20 right-4 z-10 p-3 bg-white rounded-lg shadow-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                title="Show Tags"
            >
                <TagIcon size={20} className="text-gray-600" />
            </button>
        );
    }

    return (
        <div className="fixed bottom-20 right-4 w-100 max-h-[calc(100vh-20rem)] bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200 z-10 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <div className="flex items-center gap-2">
                    <TagIcon size={20} className="text-gray-600" />
                    <h2 className="text-lg font-bold text-gray-800">Tags</h2>
                </div>
                <button
                    onClick={() => setIsExpanded(false)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Minimize"
                >
                    <ChevronDown size={20} className="text-gray-600" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {isLoading ? (
                    <div className="text-center text-gray-500 py-4 text-sm">Loading tags...</div>
                ) : tags.length === 0 ? (
                    <div className="text-center text-gray-400 py-4 text-sm">No active tags found</div>
                ) : (
                    tags.map((tag) => (
                        <div key={tag.tag_id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                            {/* Tag Header */}
                            <div className="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors">
                                {editingTagId === tag.tag_id ? (
                                    <div className="flex items-center gap-2 flex-1">
                                        <input
                                            type="text"
                                            value={editName}
                                            onChange={(e) => setEditName(e.target.value)}
                                            className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                            autoFocus
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') saveTagRename(tag.tag_id);
                                                if (e.key === 'Escape') cancelEditing();
                                            }}
                                        />
                                        <button onClick={() => saveTagRename(tag.tag_id)} className="text-green-600 hover:text-green-700">
                                            <Check size={16} />
                                        </button>
                                        <button onClick={cancelEditing} className="text-red-600 hover:text-red-700">
                                            <X size={16} />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div
                                            className="flex items-center gap-2 flex-1 cursor-pointer"
                                            onClick={() => handleExpandTag(tag.tag_id)}
                                        >
                                            {expandedTagId === tag.tag_id ? (
                                                <ChevronDown size={16} className="text-gray-500" />
                                            ) : (
                                                <ChevronRight size={16} className="text-gray-500" />
                                            )}
                                            <span className={`px-2 py-0.5 text-xs rounded-full ${tag.tag_type === 'global' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                                                }`}>
                                                {tag.tag_type}
                                            </span>
                                            <span className="text-sm font-medium text-gray-800 truncate max-w-[120px]" title={tag.tag_name}>
                                                {tag.tag_name}
                                            </span>
                                            <span className="text-xs text-gray-400">({tag.node_count})</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {onToggleTagVisibility && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onToggleTagVisibility(tag.tag_name);
                                                    }}
                                                    className={`p-1 transition-colors ${hiddenTagNames?.has(tag.tag_name)
                                                        ? 'text-gray-400 hover:text-gray-600'
                                                        : 'text-blue-500 hover:text-blue-600'
                                                        }`}
                                                    title={hiddenTagNames?.has(tag.tag_name) ? "Show nodes" : "Hide nodes"}
                                                >
                                                    {hiddenTagNames?.has(tag.tag_name) ? (
                                                        <EyeOff size={14} />
                                                    ) : (
                                                        <Eye size={14} />
                                                    )}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => startEditing(tag)}
                                                className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                                                title="Rename"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteTag(tag.tag_id)}
                                                className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Expanded Nodes List */}
                            {expandedTagId === tag.tag_id && (
                                <div className="border-t border-gray-200 bg-white max-h-60 overflow-y-auto">
                                    {isLoadingNodes ? (
                                        <div className="p-4 text-center text-xs text-gray-500">Loading nodes...</div>
                                    ) : tagNodes.length === 0 ? (
                                        <div className="p-4 text-center text-xs text-gray-400">No nodes found</div>
                                    ) : (
                                        <div className="divide-y divide-gray-100">
                                            {tagNodes.map((node) => (
                                                <div
                                                    key={node.node_id}
                                                    onClick={() => onNodeClick({
                                                        id: node.node_id,
                                                        content: node.content,
                                                        page_number: node.page_number,
                                                        paper_id: node.paper_id,
                                                        bbox: node.bbox,
                                                        paper_color: node.paper_color
                                                    })}
                                                    className="p-3 hover:bg-blue-50 cursor-pointer transition-colors group"
                                                >
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <div
                                                            className="w-2 h-2 rounded-full"
                                                            style={{ backgroundColor: node.paper_color || '#ccc' }}
                                                        />
                                                        <span className="text-xs text-gray-500">Page {node.page_number}</span>
                                                    </div>
                                                    <p className="text-xs text-gray-700 line-clamp-2 font-mono">
                                                        {node.content}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
