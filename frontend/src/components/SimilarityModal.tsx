import React, { useState, useEffect } from 'react';
import { X, Link as LinkIcon, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import { api } from '../api';
import type { Node } from '../api';

interface SimilarityModalProps {
    isOpen: boolean;
    onClose: () => void;
    noteId: number;
    onViewNode: (node: Node) => void;
}

export const SimilarityModal: React.FC<SimilarityModalProps> = ({ isOpen, onClose, noteId, onViewNode }) => {
    const [loading, setLoading] = useState(false);
    const [nodes, setNodes] = useState<Node[]>([]);
    const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
    const [linkedNodeIds, setLinkedNodeIds] = useState<Set<string>>(new Set());
    const [linking, setLinking] = useState(false);

    useEffect(() => {
        if (isOpen && noteId) {
            fetchData();
        }
    }, [isOpen, noteId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [similarNodes, links] = await Promise.all([
                api.getSimilarNodes(noteId),
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
        if (linkedNodeIds.has(nodeId)) return; // Prevent selecting already linked nodes

        const newSelected = new Set(selectedNodes);
        if (newSelected.has(nodeId)) {
            newSelected.delete(nodeId);
        } else {
            newSelected.add(nodeId);
        }
        setSelectedNodes(newSelected);
    };

    const handleLink = async () => {
        if (selectedNodes.size === 0) return;

        setLinking(true);
        try {
            const promises = Array.from(selectedNodes).map(targetId =>
                api.createLink(`note_${noteId}`, targetId)
            );
            await Promise.all(promises);

            // Update local state
            const newLinked = new Set(linkedNodeIds);
            selectedNodes.forEach(id => newLinked.add(id));
            setLinkedNodeIds(newLinked);
            setSelectedNodes(new Set());

            // alert('Links created successfully!'); // Removed alert for smoother UX
        } catch (error) {
            console.error("Failed to create links:", error);
            alert('Failed to create links.');
        } finally {
            setLinking(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 bg-black bg-opacity-10 flex items-center justify-center z-[60]">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl h-[85%] flex flex-col">
                <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <LinkIcon size={20} />
                        Similar Content
                    </h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                    {loading ? (
                        <div className="flex justify-center items-center h-full">
                            <Loader2 className="animate-spin text-blue-600" size={32} />
                        </div>
                    ) : nodes.length === 0 ? (
                        <div className="text-center text-gray-500 mt-10">
                            No similar content found.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {nodes.map(node => {
                                const isLinked = linkedNodeIds.has(node.id);
                                return (
                                    <div
                                        key={node.id}
                                        className={`bg-white p-4 rounded-lg border transition-all ${isLinked
                                                ? 'border-green-500 bg-green-50'
                                                : selectedNodes.has(node.id)
                                                    ? 'border-blue-500 ring-1 ring-blue-500'
                                                    : 'border-gray-200 hover:border-blue-300'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="pt-1">
                                                {isLinked ? (
                                                    <div className="text-green-600">
                                                        <LinkIcon size={16} />
                                                    </div>
                                                ) : (
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedNodes.has(node.id)}
                                                        onChange={() => handleToggleSelect(node.id)}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                                    />
                                                )}
                                            </div>
                                            <div className="flex-1 cursor-pointer" onClick={() => onViewNode(node)}>
                                                <div className="flex items-center gap-2 mb-1">
                                                    {node.type === 'text' ? <FileText size={16} className="text-gray-500" /> : <ImageIcon size={16} className="text-gray-500" />}
                                                    <span className="text-xs font-medium text-gray-500 uppercase">{node.type}</span>
                                                    <span className="text-xs text-gray-400">Page {node.page_number}</span>
                                                    {isLinked && <span className="text-xs font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">Linked</span>}
                                                </div>
                                                {node.type === 'text' ? (
                                                    <p className="text-sm text-gray-800 line-clamp-3">{node.content}</p>
                                                ) : (
                                                    <div className="h-20 w-full bg-gray-100 rounded overflow-hidden">
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

                <div className="p-4 border-t border-gray-200 bg-white flex justify-between items-center">
                    <span className="text-sm text-gray-600">
                        {selectedNodes.size} selected
                    </span>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md"
                        >
                            Close
                        </button>
                        <button
                            onClick={handleLink}
                            disabled={selectedNodes.size === 0 || linking}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                        >
                            {linking ? 'Linking...' : 'Link Selected'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
