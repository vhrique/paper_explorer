import React from 'react';
import { X, FileText, Image as ImageIcon } from 'lucide-react';
import type { Node } from '../api';

interface NodeDetailModalProps {
    node: Node | null;
    onClose: () => void;
}

export const NodeDetailModal: React.FC<NodeDetailModalProps> = ({ node, onClose }) => {
    if (!node) return null;

    const borderColor = node.paper_color || '#3B82F6';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200"
                onClick={e => e.stopPropagation()}
                style={{ borderTop: `6px solid ${borderColor}` }}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg" style={{ backgroundColor: `${borderColor}20` }}>
                            {node.type === 'text' ? (
                                <FileText size={20} style={{ color: borderColor }} />
                            ) : (
                                <ImageIcon size={20} style={{ color: borderColor }} />
                            )}
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800">
                                {node.type === 'text' ? 'Text Segment' : 'Extracted Image'}
                            </h3>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                <span>Page {node.page_number}</span>
                                <span>•</span>
                                <span>ID: {node.id.slice(0, 8)}...</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                    {node.type === 'text' ? (
                        <div className="prose prose-blue max-w-none">
                            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap text-lg">
                                {node.content}
                            </p>
                        </div>
                    ) : (
                        <div className="flex justify-center bg-gray-200/50 rounded-lg p-4 border border-gray-200 border-dashed">
                            <img
                                src={`/api/static/images/${node.content}`}
                                alt="Node content"
                                className="max-w-full h-auto rounded shadow-sm"
                            />
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-white border-t border-gray-100 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};
