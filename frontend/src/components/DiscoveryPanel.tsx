import { useState } from 'react';
import { api } from '../api';
import { ChevronUp, ChevronDown, Sparkles, ExternalLink, Loader2 } from 'lucide-react';

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
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
            className={`fixed bottom-0 left-0 right-0 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] transition-all duration-300 ease-in-out z-40 border-t border-gray-200 ${isExpanded ? 'h-[80vh]' : 'h-16'
                }`}
        >
            {/* Header Bar */}
            <div
                className="h-16 px-6 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
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
                    {!isExpanded && papers.length === 0 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDiscover();
                            }}
                            disabled={isLoading}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                            Find New Papers
                        </button>
                    )}
                    {isExpanded ? <ChevronDown className="text-gray-400" /> : <ChevronUp className="text-gray-400" />}
                </div>
            </div>

            {/* Content Area */}
            <div className="h-[calc(80vh-4rem)] overflow-y-auto p-6 bg-gray-50">
                <div className="max-w-4xl mx-auto space-y-6">

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
                            {papers.map((paper) => (
                                <div key={paper.paperId} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow group">
                                    <div className="flex items-start justify-between gap-4 mb-2">
                                        <h3 className="text-lg font-bold text-gray-900 leading-tight group-hover:text-indigo-600 transition-colors">
                                            <a href={paper.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                                {paper.title}
                                            </a>
                                        </h3>
                                        <span
                                            className={`text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${(paper.match_score || 0) > 0
                                                    ? 'bg-green-100 text-green-700'
                                                    : 'bg-gray-100 text-gray-600'
                                                }`}
                                            title={paper.match_score !== undefined ? `Score: ${paper.match_score.toFixed(3)}` : 'No score'}
                                        >
                                            {(paper.match_score !== undefined) ? (
                                                (paper.match_score > 0 ? 'High Relevance' : (paper.match_score > -0.5 ? 'Medium Relevance' : 'Low Relevance'))
                                            ) : 'Recommended'}
                                        </span>
                                    </div>

                                    <div className="text-sm text-gray-600 mb-3 flex flex-wrap gap-2 items-center">
                                        <span className="font-medium text-gray-800">{paper.year}</span>
                                        <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                                        <span>
                                            {paper.authors.map(a => a.name).slice(0, 3).join(', ')}
                                            {paper.authors.length > 3 && ` +${paper.authors.length - 3} others`}
                                        </span>
                                    </div>

                                    {paper.abstract && (
                                        <p className="text-gray-600 text-sm leading-relaxed mb-4 line-clamp-3 group-hover:line-clamp-none transition-all duration-300">
                                            {paper.abstract}
                                        </p>
                                    )}

                                    <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-50 mt-2">
                                        <a
                                            href={paper.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                                        >
                                            View on Semantic Scholar <ExternalLink size={14} />
                                        </a>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
