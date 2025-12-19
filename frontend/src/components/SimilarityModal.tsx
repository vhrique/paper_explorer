import React, { useState, useEffect } from 'react';
import { X, Link as LinkIcon, FileText, Image as ImageIcon, Loader2, ChevronDown, ChevronRight, StickyNote } from 'lucide-react';
import { api } from '../api';
import type { Node } from '../api';

interface SimilarityModalProps {
    isOpen: boolean;
    onClose: () => void;
    noteId: number;
    noteColor: string;
    onViewNode: (node: Node) => void;
    useNewEmbeddings?: boolean;
    onLinksChanged?: () => void | Promise<void>;
}

export const SimilarityModal: React.FC<SimilarityModalProps> = ({ isOpen, onClose, noteId, noteColor, onViewNode, useNewEmbeddings = false, onLinksChanged }) => {
    const [loading, setLoading] = useState(false);
    const [nodes, setNodes] = useState<Node[]>([]);
    const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
    const [linkedNodeIds, setLinkedNodeIds] = useState<Set<string>>(new Set());
    const [linking, setLinking] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    interface Group {
        title: string;
        nodes: Node[];
        color?: string;
    }

    // Group nodes by paper
    const groupedNodes = React.useMemo(() => {
        const groups: Record<string, Group> = {};

        nodes.forEach(node => {
            let groupId: string;
            let groupTitle: string;
            let groupColor: string | undefined;

            if (node.paper_id) {
                groupId = `paper_${node.paper_id}`;
                groupTitle = node.paper_title || `Paper ${node.paper_id}`;
                groupColor = node.paper_color;
            } else {
                groupId = 'notes';
                groupTitle = 'Notes';
                groupColor = '#FEF3C7'; // Default note color
            }

            if (!groups[groupId]) {
                groups[groupId] = { title: groupTitle, nodes: [], color: groupColor };
            }
            groups[groupId].nodes.push(node);
        });

        return groups;
    }, [nodes]);

    // Initialize all groups as expanded when nodes load
    useEffect(() => {
        if (nodes.length > 0) {
            const allGroupIds = new Set<string>();
            nodes.forEach(node => {
                if (node.paper_id) allGroupIds.add(`paper_${node.paper_id}`);
                else allGroupIds.add('notes');
            });
            setExpandedGroups(allGroupIds);
        }
    }, [nodes]);

    const toggleGroup = (groupId: string) => {
        const newExpanded = new Set(expandedGroups);
        if (newExpanded.has(groupId)) {
            newExpanded.delete(groupId);
        } else {
            newExpanded.add(groupId);
        }
        setExpandedGroups(newExpanded);
    };

    useEffect(() => {
        if (isOpen && noteId) {
            fetchData();
        }
    }, [isOpen, noteId, useNewEmbeddings]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [similarNodes, links] = await Promise.all([
                api.getSimilarNodes(noteId, useNewEmbeddings),
                api.getLinks(`note_${noteId}`)
            ]);
            setNodes(similarNodes);

            // Extract linked node IDs
            // Links can be (source=note, target=node) or (source=node, target=note)
            // But since we are linking FROM note TO node, note is likely source.
            // However, getLinks returns all links involving the node.
            const ids = new Set<string>();
            const currentNoteId = `note_${noteId}`;
            links.forEach(link => {
                if (link.source_node_id === currentNoteId) {
                    ids.add(link.target_node_id);
                } else {
                    ids.add(link.source_node_id);
                }
            });
            setLinkedNodeIds(ids);

        } catch (error) {
            console.error("Failed to fetch data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleSelect = (nodeId: string) => {
        const newSelected = new Set(selectedNodes);
        if (newSelected.has(nodeId)) {
            newSelected.delete(nodeId);
        } else {
            newSelected.add(nodeId);
        }
        setSelectedNodes(newSelected);
    };

    const handleLink = async () => {
        const nodesToLink = Array.from(selectedNodes).filter(id => !linkedNodeIds.has(id));
        if (nodesToLink.length === 0) return;

        setLinking(true);
        try {
            const promises = nodesToLink.map(targetId =>
                api.createLink(`note_${noteId}`, targetId)
            );
            await Promise.all(promises);

            // Update local state
            const newLinked = new Set(linkedNodeIds);
            nodesToLink.forEach(id => newLinked.add(id));
            setLinkedNodeIds(newLinked);

            // Deselect linked nodes
            const newSelected = new Set(selectedNodes);
            nodesToLink.forEach(id => newSelected.delete(id));
            setSelectedNodes(newSelected);

            // Trigger graph refresh
            if (onLinksChanged) {
                await onLinksChanged();
            }

        } catch (error) {
            console.error("Failed to create links:", error);
            alert('Failed to create links.');
        } finally {
            setLinking(false);
        }
    };

    const handleUnlink = async () => {
        const nodesToUnlink = Array.from(selectedNodes).filter(id => linkedNodeIds.has(id));
        if (nodesToUnlink.length === 0) return;

        setLinking(true);
        try {
            const promises = nodesToUnlink.map(targetId =>
                api.deleteLink(`note_${noteId}`, targetId)
            );
            await Promise.all(promises);

            // Update local state
            const newLinked = new Set(linkedNodeIds);
            nodesToUnlink.forEach(id => newLinked.delete(id));
            setLinkedNodeIds(newLinked);

            // Deselect unlinked nodes
            const newSelected = new Set(selectedNodes);
            nodesToUnlink.forEach(id => newSelected.delete(id));
            setSelectedNodes(newSelected);

            // Trigger graph refresh
            if (onLinksChanged) {
                await onLinksChanged();
            }

        } catch (error) {
            console.error("Failed to remove links:", error);
            alert('Failed to remove links.');
        } finally {
            setLinking(false);
        }
    };

    const selectedUnlinkedCount = Array.from(selectedNodes).filter(id => !linkedNodeIds.has(id)).length;
    const selectedLinkedCount = Array.from(selectedNodes).filter(id => linkedNodeIds.has(id)).length;

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 bg-black bg-opacity-10 flex items-center justify-center z-[60]">
            <div
                className="rounded-lg shadow-xl w-full max-w-2xl h-[85%] flex flex-col"
                style={{ backgroundColor: noteColor }}
            >
                <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-white bg-opacity-50">
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <LinkIcon size={20} />
                        Similar Content
                    </h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 bg-white bg-opacity-30">
                    {loading ? (
                        <div className="flex justify-center items-center h-full">
                            <Loader2 className="animate-spin text-blue-600" size={32} />
                        </div>
                    ) : nodes.length === 0 ? (
                        <div className="text-center text-gray-500 mt-10">
                            No similar content found.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {Object.entries(groupedNodes).map(([groupId, group]) => (
                                <div key={groupId} className="border border-gray-200 rounded-lg overflow-hidden bg-white/50">
                                    <button
                                        onClick={() => toggleGroup(groupId)}
                                        className="w-full flex items-center justify-between p-3 bg-white hover:bg-gray-50 transition-colors border-b border-gray-100"
                                    >
                                        <div className="flex items-center gap-2">
                                            {expandedGroups.has(groupId) ? <ChevronDown size={18} className="text-gray-500" /> : <ChevronRight size={18} className="text-gray-500" />}
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: group.color || '#E5E7EB' }} />
                                            <span className="font-semibold text-gray-700 text-sm text-left line-clamp-1">{group.title}</span>
                                            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full ml-2">
                                                {group.nodes.length}
                                            </span>
                                        </div>
                                    </button>

                                    {expandedGroups.has(groupId) && (
                                        <div className="p-3 space-y-3 bg-gray-50/50">
                                            {group.nodes.map(node => {
                                                const isLinked = linkedNodeIds.has(node.id);
                                                const isSelected = selectedNodes.has(node.id);

                                                return (
                                                    <div
                                                        key={node.id}
                                                        className={`bg-white p-3 rounded-lg transition-all shadow-sm ${isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:shadow-md'}`}
                                                    >
                                                        <div className="flex items-start gap-3">
                                                            <div className="pt-1">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selectedNodes.has(node.id)}
                                                                    onChange={() => handleToggleSelect(node.id)}
                                                                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                                                                />
                                                            </div>
                                                            <div className="flex-1 cursor-pointer" onClick={() => onViewNode(node)}>
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    {node.type === 'text' ? <FileText size={14} className="text-gray-400" /> :
                                                                        node.type === 'image' ? <ImageIcon size={14} className="text-gray-400" /> :
                                                                            <StickyNote size={14} className="text-gray-400" />
                                                                    }
                                                                    <span className="text-xs font-medium text-gray-500 uppercase">{node.type}</span>
                                                                    {node.page_number && <span className="text-xs text-gray-400">Page {node.page_number}</span>}
                                                                    {isLinked && <span className="text-xs font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">Linked</span>}
                                                                </div>
                                                                {node.type === 'text' || node.type === 'note' ? (
                                                                    <p className="text-sm text-gray-800 line-clamp-3 leading-relaxed">{node.content}</p>
                                                                ) : (
                                                                    <div className="h-24 w-full bg-gray-100 rounded overflow-hidden mt-1">
                                                                        <img src={node.content} alt="Content" className="h-full w-full object-cover" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-200 bg-white bg-opacity-50 flex justify-between items-center">
                    <span className="text-sm text-gray-600">
                        {selectedNodes.size} selected
                    </span>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md bg-white bg-opacity-50"
                        >
                            Close
                        </button>

                        {selectedLinkedCount > 0 && (
                            <button
                                onClick={handleUnlink}
                                disabled={linking}
                                className="px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 disabled:opacity-50 flex items-center gap-2"
                            >
                                {linking ? 'Updating...' : `Unlink (${selectedLinkedCount})`}
                            </button>
                        )}

                        {selectedUnlinkedCount > 0 && (
                            <button
                                onClick={handleLink}
                                disabled={linking}
                                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {linking ? 'Updating...' : `Link (${selectedUnlinkedCount})`}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
