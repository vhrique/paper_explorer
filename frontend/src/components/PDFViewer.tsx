import React, { useState, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { X, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import type { Node, Paper } from '../api';
import { api } from '../api';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Set up the worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface PDFViewerProps {
    node: Node;
    onClose: () => void;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({ node, onClose }) => {
    const [paper, setPaper] = useState<Paper | null>(null);
    const [numPages, setNumPages] = useState<number>(0);
    const [scale, setScale] = useState<number>(1.0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const highlightedPageRef = useRef<HTMLDivElement>(null);

    // Fetch paper data when paper_id changes
    useEffect(() => {
        const fetchPaper = async () => {
            try {
                setLoading(true);
                const paperData = await api.getPaper(node.paper_id);
                setPaper(paperData);
                setError(null);
            } catch (err) {
                console.error('Failed to load paper:', err);
                setError('Failed to load PDF');
            } finally {
                setLoading(false);
            }
        };

        fetchPaper();
    }, [node.paper_id]);

    // Scroll to highlighted page when node changes or pages are loaded
    useEffect(() => {
        if (numPages > 0 && highlightedPageRef.current) {
            // Small delay to ensure the page is rendered and layout is stable
            setTimeout(() => {
                highlightedPageRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                });
            }, 100);
        }
    }, [numPages, node.id]);

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
    };

    const handleZoomIn = () => setScale(prev => Math.min(prev + 0.2, 3.0));
    const handleZoomOut = () => setScale(prev => Math.max(prev - 0.2, 0.5));

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-2" />
                    <p className="text-gray-600">Loading PDF...</p>
                </div>
            </div>
        );
    }

    if (error || !paper) {
        return (
            <div className="h-full flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <p className="text-red-600">{error || 'Paper not found'}</p>
                    <button
                        onClick={onClose}
                        className="mt-4 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    const pdfUrl = `/api/static/pdfs/${paper.project_id}/${paper.filename}`;
    const borderColor = node.paper_color || '#3B82F6';

    // Convert bbox from [x0, y0, x1, y1] to position and size
    // bbox coordinates are in PDF points (1/72 inch)
    const [x0, y0, x1, y1] = node.bbox;

    return (
        <div className="h-full flex flex-col bg-white border-l border-gray-200">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-800 truncate">{paper.title}</h3>
                    <p className="text-sm text-gray-600">
                        Highlighted on page {node.page_number} of {numPages}
                    </p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                    <button
                        onClick={handleZoomOut}
                        className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                        title="Zoom Out"
                    >
                        <ZoomOut size={20} className="text-gray-600" />
                    </button>
                    <span className="text-sm text-gray-600 min-w-[3rem] text-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <button
                        onClick={handleZoomIn}
                        className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                        title="Zoom In"
                    >
                        <ZoomIn size={20} className="text-gray-600" />
                    </button>
                    <div className="w-px h-6 bg-gray-300 mx-2" />
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                        title="Close PDF Viewer"
                    >
                        <X size={20} className="text-gray-600" />
                    </button>
                </div>
            </div>

            {/* PDF Content - Scrollable */}
            <div className="flex-1 overflow-y-auto bg-gray-100 p-4">
                <div className="flex flex-col items-center gap-4">
                    <Document
                        file={pdfUrl}
                        onLoadSuccess={onDocumentLoadSuccess}
                        loading={
                            <div className="flex items-center justify-center p-8">
                                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                            </div>
                        }
                    >
                        {/* Render all pages */}
                        {Array.from(new Array(numPages), (el, index) => {
                            const pageNumber = index + 1;
                            const isHighlightedPage = pageNumber === node.page_number;

                            return (
                                <div
                                    key={`page_${pageNumber}`}
                                    className="relative mb-4 inline-block"
                                    ref={isHighlightedPage ? highlightedPageRef : null}
                                >
                                    <Page
                                        pageNumber={pageNumber}
                                        scale={scale}
                                        renderTextLayer={true}
                                        renderAnnotationLayer={true}
                                        className="shadow-lg"
                                    />
                                    {/* Only show highlight on the correct page */}
                                    {isHighlightedPage && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                left: `${x0 * scale}px`,
                                                top: `${y0 * scale}px`,
                                                width: `${(x1 - x0) * scale}px`,
                                                height: `${(y1 - y0) * scale}px`,
                                                border: `3px solid ${borderColor}`,
                                                backgroundColor: `${borderColor}20`,
                                                pointerEvents: 'none',
                                                zIndex: 10,
                                            }}
                                        />
                                    )}
                                    {/* Page number label */}
                                    <div className="text-center text-sm text-gray-600 mt-2">
                                        Page {pageNumber}
                                    </div>
                                </div>
                            );
                        })}
                    </Document>
                </div>
            </div>
        </div>
    );
};