import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { Paper } from '../api';
import { PDFUploader } from './PDFUploader';
import { FileText, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';

interface PapersSidebarProps {
    projectId: number;
    onUploadComplete: () => void;
}

export const PapersSidebar: React.FC<PapersSidebarProps> = ({ projectId, onUploadComplete }) => {
    const [papers, setPapers] = useState<Paper[]>([]);
    const [isExpanded, setIsExpanded] = useState(true);
    const [isLoading, setIsLoading] = useState(true);

    const loadPapers = async () => {
        try {
            setIsLoading(true);
            const data = await api.listPapers(projectId);
            setPapers(data);
        } catch (error) {
            console.error('Failed to load papers:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadPapers();
    }, [projectId]);

    const handleUploadComplete = () => {
        loadPapers(); // Reload papers list
        onUploadComplete(); // Trigger parent callback
    };

    const handleDeletePaper = async (paperId: number, paperTitle: string, e: React.MouseEvent) => {
        e.stopPropagation();

        if (!window.confirm(`Are you sure you want to delete "${paperTitle}"? This will remove all its nodes from the graph.`)) {
            return;
        }

        try {
            await api.deletePaper(paperId);
            setPapers(papers.filter(p => p.id !== paperId));
            onUploadComplete(); // Refresh the graph
        } catch (error) {
            console.error('Failed to delete paper:', error);
            alert('Failed to delete paper. Please try again.');
        }
    };

    if (!isExpanded) {
        return (
            <button
                onClick={() => setIsExpanded(true)}
                className="fixed top-24 right-4 z-10 p-3 bg-white rounded-lg shadow-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                title="Show papers"
            >
                <ChevronLeft size={20} className="text-gray-600" />
            </button>
        );
    }

    return (
        <div className="fixed top-20 right-4 w-96 max-h-[calc(100vh-6rem)] bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200 z-10 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-800">Uploaded Papers</h2>
                <button
                    onClick={() => setIsExpanded(false)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Minimize"
                >
                    <ChevronRight size={20} className="text-gray-600" />
                </button>
            </div>

            {/* Upload Section */}
            <div className="p-4 border-b border-gray-200 bg-gradient-to-br from-blue-50 to-indigo-50">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Upload New Paper</h3>
                <PDFUploader projectId={projectId} onUploadComplete={handleUploadComplete} />
            </div>

            {/* Papers List */}
            <div className="flex-1 overflow-y-auto p-4">
                {isLoading ? (
                    <div className="text-center text-gray-500 py-8">Loading papers...</div>
                ) : papers.length === 0 ? (
                    <div className="text-center text-gray-400 py-8">
                        <FileText size={48} className="mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No papers uploaded yet</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {papers.map((paper) => (
                            <div
                                key={paper.id}
                                className="group p-3 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all relative"
                            >
                                <button
                                    onClick={(e) => handleDeletePaper(paper.id, paper.title, e)}
                                    className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                    title="Delete paper"
                                >
                                    <Trash2 size={16} />
                                </button>

                                <div className="flex items-start gap-3">
                                    <div className="p-2 rounded-lg" style={{ backgroundColor: `${paper.color}20` }}>
                                        <FileText size={20} style={{ color: paper.color }} />
                                    </div>
                                    <div className="flex-1 min-w-0 pr-8">
                                        <h4 className="font-semibold text-sm text-gray-800 truncate">
                                            {paper.title}
                                        </h4>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {new Date(paper.created_at).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
