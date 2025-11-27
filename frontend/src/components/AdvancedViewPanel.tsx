import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { TagSummary } from '../api';
import { Settings, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

interface AdvancedViewPanelProps {
    projectId: number;
    useNewEmbeddings: boolean;
    onToggleEmbeddings: (useNew: boolean) => void;
}

export const AdvancedViewPanel: React.FC<AdvancedViewPanelProps> = ({
    projectId,
    useNewEmbeddings,
    onToggleEmbeddings
}) => {
    const [tagSummary, setTagSummary] = useState<TagSummary[]>([]);
    const [isExpanded, setIsExpanded] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [isComputing, setIsComputing] = useState(false);
    const [computeMessage, setComputeMessage] = useState<string | null>(null);
    const [useGlobalContext, setUseGlobalContext] = useState(false);

    const loadTagSummary = async () => {
        try {
            setIsLoading(true);
            const data = await api.getTagSummary(projectId);
            setTagSummary(data);
        } catch (error) {
            console.error('Failed to load tag summary:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadTagSummary();
    }, [projectId]);

    const handleComputeEmbeddings = async () => {
        try {
            setIsComputing(true);
            setComputeMessage(null);
            const result = await api.computeNewEmbeddings(projectId, useGlobalContext);
            setComputeMessage(`✓ ${result.message}`);
            setTimeout(() => setComputeMessage(null), 5000);
        } catch (error) {
            console.error('Failed to compute embeddings:', error);
            setComputeMessage('✗ Failed to compute new embeddings');
            setTimeout(() => setComputeMessage(null), 5000);
        } finally {
            setIsComputing(false);
        }
    };

    const handleToggle = (checked: boolean) => {
        onToggleEmbeddings(checked);
    };

    if (!isExpanded) {
        return (
            <button
                onClick={() => setIsExpanded(true)}
                className="fixed top-24 left-4 z-10 p-3 bg-white rounded-lg shadow-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                title="Show advanced view"
            >
                <ChevronRight size={20} className="text-gray-600" />
            </button>
        );
    }

    return (
        <div className="fixed top-20 left-4 w-96 max-h-[calc(100vh-6rem)] bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200 z-10 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <div className="flex items-center gap-2">
                    <Settings size={20} className="text-gray-600" />
                    <h2 className="text-lg font-bold text-gray-800">Advanced View</h2>
                </div>
                <button
                    onClick={() => setIsExpanded(false)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Minimize"
                >
                    <ChevronLeft size={20} className="text-gray-600" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Tag Summary Section */}
                <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Tag Summary</h3>
                    {isLoading ? (
                        <div className="text-center text-gray-500 py-4 text-sm">Loading tags...</div>
                    ) : tagSummary.length === 0 ? (
                        <div className="text-center text-gray-400 py-4 text-sm">No tags yet</div>
                    ) : (
                        <div className="space-y-2">
                            {tagSummary.map((tag) => (
                                <div
                                    key={tag.tag_id}
                                    className="flex items-center justify-between p-2 bg-white rounded-lg border border-gray-200"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 text-xs rounded-full ${tag.tag_type === 'global'
                                            ? 'bg-blue-100 text-blue-700'
                                            : 'bg-green-100 text-green-700'
                                            }`}>
                                            {tag.tag_type}
                                        </span>
                                        <span className="text-sm font-medium text-gray-800">{tag.tag_name}</span>
                                    </div>
                                    <span className="text-xs text-gray-500">{tag.node_count} nodes</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Embedding Controls Section */}
                <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Embedding View</h3>

                    {/* Toggle */}
                    <div className="flex items-center justify-between mb-3 p-3 bg-white rounded-lg border border-gray-200">
                        <label htmlFor="use-tags-toggle" className="text-sm font-medium text-gray-700 cursor-pointer">
                            Use Tags for View
                        </label>
                        <button
                            id="use-tags-toggle"
                            onClick={() => handleToggle(!useNewEmbeddings)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${useNewEmbeddings ? 'bg-blue-600' : 'bg-gray-300'
                                }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${useNewEmbeddings ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                    </div>

                    {/* Global Context Toggle */}
                    <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
                        <div className="flex flex-col">
                            <label htmlFor="global-context-toggle" className="text-sm font-medium text-gray-700 cursor-pointer">
                                Use Global Tags Info
                            </label>
                            <span className="text-xs text-gray-500 mt-0.5">Use globally-tagged nodes from other projects</span>
                        </div>
                        <button
                            id="global-context-toggle"
                            onClick={() => setUseGlobalContext(!useGlobalContext)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${useGlobalContext ? 'bg-purple-600' : 'bg-gray-300'
                                }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${useGlobalContext ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                    </div>

                    {/* Compute Button */}
                    <button
                        onClick={handleComputeEmbeddings}
                        disabled={isComputing}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                    >
                        <Sparkles size={18} />
                        {isComputing ? 'Computing...' : 'Compute New View'}
                    </button>

                    {/* Message */}
                    {computeMessage && (
                        <div className={`mt-3 p-2 rounded-lg text-sm ${computeMessage.startsWith('✓')
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                            }`}>
                            {computeMessage}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
