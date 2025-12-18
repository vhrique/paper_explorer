import { ExternalLink, X } from 'lucide-react';

interface PaperCardProps {
    title: string;
    abstract?: string | null; // Allow null to match API return if happened
    authors: { name: string }[] | string[]; // Adapt to both API responses (strings vs objects if any divergence)
    year?: number;
    url?: string;
    match_score?: number;
    onClose?: () => void;
    className?: string;
    compact?: boolean; // For graph overlay mode
}

export function PaperCard({
    title,
    abstract,
    authors,
    year,
    url,
    match_score,
    onClose,
    className = "",
    compact = false
}: PaperCardProps) {
    // Helper to normalize authors list
    const authorNames = authors.map(a => typeof a === 'string' ? a : a.name);

    return (
        <div className={`bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow group relative ${className}`}>
            {onClose && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                    className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 z-10"
                >
                    <X size={16} />
                </button>
            )}

            <div className={`p-5 ${compact ? 'max-h-[400px] overflow-y-auto' : ''}`}>
                <div className="flex items-start justify-between gap-4 mb-2 pr-6">
                    <h3 className="text-lg font-bold text-gray-900 leading-tight group-hover:text-indigo-600 transition-colors">
                        {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                {title}
                            </a>
                        ) : (
                            title
                        )}
                    </h3>

                    {match_score !== undefined && (
                        <span
                            className={`text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${(match_score || 0) > 0
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                                }`}
                            title={`Score: ${match_score.toFixed(3)}`}
                        >
                            {match_score > 0 ? 'High Relevance' : (match_score > -0.5 ? 'Medium Relevance' : 'Low Relevance')}
                        </span>
                    )}
                </div>

                <div className="text-sm text-gray-600 mb-3 flex flex-wrap gap-2 items-center">
                    {year && <span className="font-medium text-gray-800">{year}</span>}
                    {year && authorNames.length > 0 && <span className="w-1 h-1 bg-gray-300 rounded-full"></span>}
                    <span>
                        {authorNames.slice(0, 3).join(', ')}
                        {authorNames.length > 3 && ` +${authorNames.length - 3} others`}
                    </span>
                </div>

                {abstract && (
                    <p className={`text-gray-600 text-sm leading-relaxed mb-4 ${!compact ? 'line-clamp-3 group-hover:line-clamp-none transition-all duration-300' : ''}`}>
                        {abstract}
                    </p>
                )}

                {url && (
                    <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-50 mt-2">
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                        >
                            View on Semantic Scholar <ExternalLink size={14} />
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
}
