import { useState, useEffect } from 'react';
import { api } from '../api';
import type { GraphData } from '../api';
import { ChevronUp, ChevronDown, Sparkles, ExternalLink, Loader2 } from 'lucide-react';
import { DiscoveryGraph } from './DiscoveryGraph';
import { PaperCard } from './PaperCard';

interface DiscoveryPanelProps {
    projectId: number;
}

interface RecommendedPaper {
    paperId: string;
    title: string;
    abstract: string | null;
    authors: { name: string }[];
    year: number;
    url: string;
    match_score?: number;
}

export function DiscoveryPanel({ projectId }: DiscoveryPanelProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [papers, setPapers] = useState<RecommendedPaper[]>([]);
    const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
    const [isLoading, setIsLoading] = useState(false);
    const [isGraphLoading, setIsGraphLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch context graph when expanded
    useEffect(() => {
        if (isExpanded && graphData.nodes.length === 0) {
            setIsGraphLoading(true);
            api.getDiscoveryContext(projectId)
                .then(data => {
                    setGraphData(data);
                })
                .catch(err => {
                    console.error("Failed to load context graph", err);
                })
                .finally(() => {
                    setIsGraphLoading(false);
                });
        }
    }, [isExpanded, projectId]);

    const handleDiscover = async () => {
        setIsExpanded(true); // Maximize when starting discovery
        setIsLoading(true);
        setError(null);
        try {
            const results = await api.discoverPapers(projectId);
            setPapers(results);
        } catch (err: any) {
            console.error('Discovery failed:', err);
            setError('Failed to discover papers. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const toggleExpand = () => {
        setIsExpanded(!isExpanded);
    };

    return (
        <div
            className={`fixed bottom-0 left-0 right-0 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] transition-all duration-300 ease-in-out z-40 border-t border-gray-200 ${isExpanded ? 'h-[85vh]' : 'h-16'
                }`}
        >
            {/* Header Bar */}
            <div
                className="h-16 px-6 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-200"
                onClick={toggleExpand}
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
                        <Sparkles size={20} />
                    </div>
                    <h2 className="font-bold text-gray-800 text-lg">Discover Papers</h2>
                    {papers.length > 0 && (
                        <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            {papers.length} results
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDiscover();
                        }}
                        disabled={isLoading}
                        className={`px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2 ${isLoading ? 'cursor-not-allowed' : ''}`}
                    >
                        {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                        {papers.length > 0 ? "Refresh" : "Find New Papers"}
                    </button>
                    {isExpanded ? <ChevronDown className="text-gray-400" /> : <ChevronUp className="text-gray-400" />}
                </div>
            </div>

            {/* Content Area - Split View */}
            <div className="h-[calc(85vh-4rem)] flex">

                {/* Left Panel: Context Graph */}
                <div className="w-1/2 h-full border-r border-gray-200 bg-gray-50 relative">
                    {isGraphLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
                            <Loader2 className="animate-spin text-indigo-600" size={32} />
                        </div>
                    )}
                    <DiscoveryGraph data={graphData} />

                    {/* Legend / Info */}
                    <div className="absolute bottom-4 left-4 bg-white/90 p-3 rounded-lg shadow-sm border border-gray-200 text-xs text-gray-600 space-y-1 backdrop-blur-sm">
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-blue-500"></span> Project Paper
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-green-500"></span> Reference (Outgoing)
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-orange-500"></span> Citation (Incoming)
                        </div>
                        <div className="pt-2 text-[10px] text-gray-400 border-t border-gray-100 mt-1">
                            Layout based on semantic similarity
                        </div>
                    </div>
                </div>

                {/* Right Panel: Discovery Results */}
                <div className="w-1/2 h-full overflow-y-auto p-6 bg-white">
                    <div className="max-w-2xl mx-auto space-y-6">

                        {/* Action Button (Large center if no results yet) */}
                        {papers.length === 0 && !isLoading && !error && (
                            <div className="text-center py-20">
                                <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                                    <Sparkles size={32} />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900 mb-2">Discover New Research</h3>
                                <p className="text-gray-600 mb-8 max-w-md mx-auto">
                                    We'll analyze your current papers and find relevant research using AI and Semantic Scholar's huge database.
                                </p>
                                <button
                                    onClick={handleDiscover}
                                    className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:-translate-y-0.5 transition-all flex items-center gap-2 mx-auto"
                                >
                                    Start Discovery
                                </button>
                            </div>
                        )}

                        {/* Loading State */}
                        {isLoading && (
                            <div className="text-center py-20 flex flex-col items-center">
                                <Loader2 className="animate-spin text-indigo-600 mb-4" size={48} />
                                <h3 className="text-lg font-semibold text-gray-800">Analyzing your research...</h3>
                                <p className="text-gray-500">Finding and ranking similar papers</p>
                            </div>
                        )}

                        {/* Error State */}
                        {error && (
                            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-center">
                                {error}
                            </div>
                        )}

                        {/* Results List */}
                        {papers.length > 0 && (
                            <div className="grid gap-4">
                                <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                    Recommended Papers
                                </div>
                                {papers.map((paper) => (
                                    <PaperCard
                                        key={paper.paperId}
                                        title={paper.title}
                                        abstract={paper.abstract}
                                        authors={paper.authors}
                                        year={paper.year}
                                        url={paper.url}
                                        match_score={paper.match_score}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
