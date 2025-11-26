import React from 'react';
import { X, FileText, Image as ImageIcon } from 'lucide-react';
import { Node } from '../api';

interface DetailPanelProps {
    node: Node | null;
    onClose: () => void;
}

export const DetailPanel: React.FC<DetailPanelProps> = ({ node, onClose }) => {
    if (!node) return null;

    return (
        <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl border-l border-gray-200 p-6 overflow-y-auto z-50 transform transition-transform duration-300 ease-in-out">
            <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-2 text-gray-500">
                    {node.type === 'text' ? <FileText size={20} /> : <ImageIcon size={20} />}
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

            <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Content</h3>
                {node.type === 'text' ? (
                    <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                        {node.content}
                    </p>
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
