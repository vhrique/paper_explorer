import React, { useState, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { X, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import type { Node, Paper, Tag } from '../api';
import { api } from '../api';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Set up the worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface PDFViewerProps {
    node: Node;
    onClose: () => void;
    projectId: number;
    onTagsUpdated?: () => void;
    onPDFClick?: (nodeId: string) => void;
    allNodes?: Node[];  // All nodes in the project for hit detection
}

export const PDFViewer: React.FC<PDFViewerProps> = ({ node, onClose, projectId, onTagsUpdated, onPDFClick, allNodes }) => {
    const [paper, setPaper] = useState<Paper | null>(null);
    const [numPages, setNumPages] = useState<number>(0);
    const [scale, setScale] = useState<number>(1.0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const highlightedPageRef = useRef<HTMLDivElement>(null);
    const [pageDimensions, setPageDimensions] = useState<Map<number, { width: number; height: number }>>(new Map());

    // Tag management state
    const [tags, setTags] = useState<Tag[]>([]);
    const [availableTags, setAvailableTags] = useState<Tag[]>([]);
    const [showTagInput, setShowTagInput] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [isGlobalTag, setIsGlobalTag] = useState(false);

    // Calculate suggestions
    const suggestions = React.useMemo(() => {
        console.log('Node tag scores:', node.tag_scores);
        if (!node.tag_scores) return [];
        const currentTagNames = new Set(tags.map(t => t.name));
        return Object.entries(node.tag_scores)
            .filter(([tag, score]) => score > 0.0 && !currentTagNames.has(tag))
            .sort((a, b) => b[1] - a[1])
            .map(([tag, score]) => ({ name: tag, score }));
    }, [node.tag_scores, tags]);

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

    // Load tags for the current node
    useEffect(() => {
        const loadTags = async () => {
            try {
                const nodeTags = await api.getNodeTags(node.id);
                setTags(nodeTags);
            } catch (error) {
                console.error('Failed to load node tags:', error);
            }
        };

        const loadAvailableTags = async () => {
            try {
                const allTags = await api.listTags(projectId);
                setAvailableTags(allTags);
            } catch (error) {
                console.error('Failed to load available tags:', error);
            }
        };

        loadTags();
        loadAvailableTags();
    }, [node.id, projectId]);

    // Scroll to highlighted page
    const scrollToHighlight = () => {
        if (highlightedPageRef.current) {
            setTimeout(() => {
                highlightedPageRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                });
            }, 100);
        }
    };

    // Scroll when node changes (same paper)
    useEffect(() => {
        if (numPages > 0) {
            scrollToHighlight();
        }
    }, [node.id, numPages]);

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
        // Scroll after document is loaded
        setTimeout(scrollToHighlight, 100);
    };

    const handleZoomIn = () => setScale(prev => Math.min(prev + 0.2, 3.0));
    const handleZoomOut = () => setScale(prev => Math.max(prev - 0.2, 0.5));

    // Handle clicks on PDF pages to select nodes
    const handlePageClick = (e: React.MouseEvent<HTMLDivElement>, pageNumber: number) => {
        if (!onPDFClick || !allNodes) return;

        const pageDim = pageDimensions.get(pageNumber);
        if (!pageDim) return;

        // Find the actual canvas element (rendered by react-pdf)
        const canvas = e.currentTarget.querySelector('canvas');
        if (!canvas) return;

        // Get click position relative to the canvas
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Transform to PDF coordinates (accounting for scale)
        // PDF coordinates: origin at top-left (matching backend bbox format)
        // Browser coordinates: origin at top-left
        const pdfX = clickX / scale;
        const pdfY = clickY / scale;

        console.log('Click:', { clickX, clickY, pdfX, pdfY, scale, pageDim });

        // Find all nodes on this page FROM THE CURRENT PAPER ONLY
        const nodesOnPage = allNodes.filter(n =>
            n.page_number === pageNumber && n.paper_id === node.paper_id
        );

        // Find nodes whose bounding box contains the click point
        const clickedNodes = nodesOnPage.filter(n => {
            const [x0, y0, x1, y1] = n.bbox;
            const contains = pdfX >= x0 && pdfX <= x1 && pdfY >= y0 && pdfY <= y1;
            if (contains) {
                console.log('Node bbox:', { id: n.id, bbox: n.bbox, contains });
            }
            return contains;
        });

        console.log('Clicked nodes:', clickedNodes.length);

        if (clickedNodes.length === 0) return;

        // If multiple overlapping boxes, select the smallest one (most specific)
        const selectedNode = clickedNodes.reduce((smallest, current) => {
            const smallestArea = (smallest.bbox[2] - smallest.bbox[0]) * (smallest.bbox[3] - smallest.bbox[1]);
            const currentArea = (current.bbox[2] - current.bbox[0]) * (current.bbox[3] - current.bbox[1]);
            return currentArea < smallestArea ? current : smallest;
        });

        console.log('Selected node:', selectedNode.id);
        onPDFClick(selectedNode.id);
    };

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

    const pdfUrl = paper.url;
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

            {/* Tags Section */}
            <div className="p-4 border-b border-gray-200 bg-white">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-gray-500 uppercase">Tags</h4>
                    {!showTagInput && (
                        <button
                            onClick={() => setShowTagInput(true)}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                        >
                            + Add Tag
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap gap-2 mb-2">
                    {tags.map(tag => (
                        <span
                            key={tag.id}
                            className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${tag.type === 'global' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                                }`}
                        >
                            {tag.name}
                            <button
                                onClick={async () => {
                                    await api.removeNodeTag(node.id, tag.id);
                                    const updatedTags = await api.getNodeTags(node.id);
                                    setTags(updatedTags);

                                    // Notify parent that tags were updated
                                    if (onTagsUpdated) {
                                        onTagsUpdated();
                                    }
                                }}
                                className="hover:text-red-600"
                            >
                                <X size={12} />
                            </button>
                        </span>
                    ))}

                    {/* Suggestions merged into tags list */}
                    {suggestions.map(({ name, score }) => (
                        <button
                            key={name}
                            onClick={async () => {
                                try {
                                    let tag = availableTags.find(t => t.name === name);

                                    // If tag not found in local list, try to create/fetch it
                                    if (!tag) {
                                        try {
                                            // Try to create as local tag
                                            tag = await api.createTag(name, 'local', projectId);
                                            setAvailableTags([...availableTags, tag]);
                                        } catch (e) {
                                            // If creation fails (e.g. exists), try to refresh available tags
                                            const allTags = await api.listTags(projectId);
                                            setAvailableTags(allTags);
                                            tag = allTags.find(t => t.name === name);
                                        }
                                    }

                                    if (tag) {
                                        await api.addNodeTag(node.id, tag.id);
                                        const updatedTags = await api.getNodeTags(node.id);
                                        setTags(updatedTags);
                                        if (onTagsUpdated) onTagsUpdated();
                                    }
                                } catch (error) {
                                    console.error('Failed to add suggestion:', error);
                                }
                            }}
                            className="px-2 py-1 rounded-full text-xs font-medium border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 flex items-center gap-1 transition-colors opacity-75 hover:opacity-100"
                            title={`Suggested Tag (Score: ${score.toFixed(2)})`}
                        >
                            + {name}
                        </button>
                    ))}
                </div>

                {
                    showTagInput && (
                        <div className="bg-gray-50 p-3 rounded-lg">
                            <input
                                type="text"
                                value={newTagName}
                                onChange={(e) => setNewTagName(e.target.value)}
                                placeholder="Tag name..."
                                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1 mb-2"
                            />
                            <div className="flex items-center gap-2 mb-2">
                                <input
                                    type="checkbox"
                                    id="isGlobal"
                                    checked={isGlobalTag}
                                    onChange={(e) => setIsGlobalTag(e.target.checked)}
                                />
                                <label htmlFor="isGlobal" className="text-xs text-gray-600">Global Tag</label>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={async () => {
                                        if (!newTagName.trim()) return;
                                        try {
                                            // Check if tag exists
                                            let tag = availableTags.find(
                                                t => t.name === newTagName && t.type === (isGlobalTag ? 'global' : 'local')
                                            );

                                            // Create tag if it doesn't exist
                                            if (!tag) {
                                                tag = await api.createTag(
                                                    newTagName,
                                                    isGlobalTag ? 'global' : 'local',
                                                    isGlobalTag ? undefined : projectId
                                                );
                                                setAvailableTags([...availableTags, tag]);
                                            }

                                            // Add tag to node
                                            await api.addNodeTag(node.id, tag.id);
                                            const updatedTags = await api.getNodeTags(node.id);
                                            setTags(updatedTags);
                                            setNewTagName('');
                                            setShowTagInput(false);

                                            // Notify parent that tags were updated
                                            if (onTagsUpdated) {
                                                onTagsUpdated();
                                            }
                                        } catch (error) {
                                            console.error('Failed to add tag:', error);
                                        }
                                    }}
                                    className="px-3 py-1 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700"
                                >
                                    Add
                                </button>
                                <button
                                    onClick={() => {
                                        setShowTagInput(false);
                                        setNewTagName('');
                                    }}
                                    className="px-3 py-1 text-gray-600 text-xs hover:bg-gray-200 rounded-md"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )
                }
            </div >

            {/* PDF Content - Scrollable */}
            < div className="flex-1 overflow-y-auto bg-gray-100 p-4" >
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
                                    <div
                                        onClick={(e) => handlePageClick(e, pageNumber)}
                                        className="relative cursor-pointer"
                                        style={{ display: 'inline-block' }}
                                    >
                                        <Page
                                            pageNumber={pageNumber}
                                            scale={scale}
                                            renderTextLayer={true}
                                            renderAnnotationLayer={true}
                                            className="shadow-lg"
                                            onLoadSuccess={(page) => {
                                                // Store page dimensions for coordinate transformation
                                                setPageDimensions(prev => {
                                                    const newMap = new Map(prev);
                                                    newMap.set(pageNumber, {
                                                        width: page.width,
                                                        height: page.height
                                                    });
                                                    return newMap;
                                                });
                                            }}
                                        />
                                    </div>
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
            </div >
        </div >
    );
};