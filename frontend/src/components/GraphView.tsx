import React, { useCallback, useEffect } from 'react';
import ReactFlow, {
    Background,
    Controls,
    useNodesState,
    useEdgesState,
    MarkerType,
    Handle,
    Position
} from 'reactflow';
import type { Node, Edge, NodeTypes, Connection } from 'reactflow';
import 'reactflow/dist/style.css';
import type { Node as APINode, Edge as APIEdge } from '../api';
import { Link2, StickyNote } from 'lucide-react';
import FloatingEdge from './FloatingEdge';

// Custom Node Components
const TextNode = ({ data }: any) => {
    const borderColor = data.original?.paper_color || '#3B82F6';
    const hasTags = data.original?.has_tags || false;
    const [showNoteIcon, setShowNoteIcon] = React.useState(false);

    return (
        <div
            className="px-4 py-2 shadow-md rounded-md bg-white w-64 relative"
            style={{ borderWidth: '2px', borderStyle: 'solid', borderColor }}
            onMouseEnter={() => setShowNoteIcon(true)}
            onMouseLeave={() => setShowNoteIcon(false)}
        >
            <Handle type="target" position={Position.Top} className="w-16" style={{ background: borderColor }} />
            {hasTags && (
                <div className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center" title="Has tags">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-500">
                        <path fillRule="evenodd" d="M5.5 3A2.5 2.5 0 003 5.5v2.879a2.5 2.5 0 00.732 1.767l6.5 6.5a2.5 2.5 0 003.536 0l2.878-2.878a2.5 2.5 0 000-3.536l-6.5-6.5A2.5 2.5 0 008.38 3H5.5zM6 7a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                    </svg>
                </div>
            )}
            {showNoteIcon && data.onCreateNoteFromNode && (
                <div
                    className="absolute top-1 left-1 w-6 h-6 flex items-center justify-center bg-blue-500 rounded-full cursor-pointer hover:bg-blue-600 transition-colors shadow-md z-10"
                    title="Create note from this text"
                    onClick={(e) => {
                        e.stopPropagation();
                        data.onCreateNoteFromNode(data.original.id);
                    }}
                >
                    <StickyNote size={14} className="text-white" />
                </div>
            )}
            <div className="flex items-center">
                <div className="ml-2">
                    <div className="text-xs font-bold text-gray-500 mb-1">Page {data.page_number}</div>
                    <div className="text-xs text-gray-800 line-clamp-3">{data.content}</div>
                </div>
            </div>
            <Handle type="source" position={Position.Bottom} className="w-16" style={{ background: borderColor }} />
        </div>
    );
};

const ImageNode = ({ data }: any) => {
    const borderColor = data.original?.paper_color || '#8B5CF6';
    const hasTags = data.original?.has_tags || false;
    const [showNoteIcon, setShowNoteIcon] = React.useState(false);

    return (
        <div
            className="shadow-md rounded-md bg-white p-1 relative"
            style={{ borderWidth: '2px', borderStyle: 'solid', borderColor }}
            onMouseEnter={() => setShowNoteIcon(true)}
            onMouseLeave={() => setShowNoteIcon(false)}
        >
            <Handle type="target" position={Position.Top} className="w-16" style={{ background: borderColor }} />
            {hasTags && (
                <div className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center z-10" title="Has tags">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-500">
                        <path fillRule="evenodd" d="M5.5 3A2.5 2.5 0 003 5.5v2.879a2.5 2.5 0 00.732 1.767l6.5 6.5a2.5 2.5 0 003.536 0l2.878-2.878a2.5 2.5 0 000-3.536l-6.5-6.5A2.5 2.5 0 008.38 3H5.5zM6 7a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                    </svg>
                </div>
            )}
            {showNoteIcon && data.onCreateNoteFromNode && (
                <div
                    className="absolute top-1 left-1 w-6 h-6 flex items-center justify-center bg-blue-500 rounded-full cursor-pointer hover:bg-blue-600 transition-colors shadow-md z-10"
                    title="Create note from this image"
                    onClick={(e) => {
                        e.stopPropagation();
                        data.onCreateNoteFromNode(data.original.id);
                    }}
                >
                    <StickyNote size={14} className="text-white" />
                </div>
            )}
            <img
                src={data.content}
                alt="Extracted"
                className="w-32 h-auto rounded-sm"
            />
            <div className="text-[10px] text-center mt-1 text-gray-500">Page {data.page_number}</div>
            <Handle type="source" position={Position.Bottom} className="w-16" style={{ background: borderColor }} />
        </div>
    );
};

const NoteNode = ({ data }: any) => {
    const bgColor = data.original?.paper_color || '#FEF3C7';
    const hasTags = data.original?.has_tags || false;
    const title = data.original?.title;
    const [showLinkIcon, setShowLinkIcon] = React.useState(false);

    return (
        <div
            className="shadow-lg rounded-sm p-4 w-48 h-48 relative flex flex-col transform hover:scale-105 transition-transform"
            style={{
                backgroundColor: bgColor,
                boxShadow: '2px 2px 5px rgba(0,0,0,0.1)'
            }}
            onMouseEnter={() => setShowLinkIcon(true)}
            onMouseLeave={() => setShowLinkIcon(false)}
        >
            <Handle type="target" position={Position.Top} className="w-16 opacity-0" />

            {hasTags && (
                <div className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center" title="Has tags">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-500">
                        <path fillRule="evenodd" d="M5.5 3A2.5 2.5 0 003 5.5v2.879a2.5 2.5 0 00.732 1.767l6.5 6.5a2.5 2.5 0 003.536 0l2.878-2.878a2.5 2.5 0 000-3.536l-6.5-6.5A2.5 2.5 0 008.38 3H5.5zM6 7a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                    </svg>
                </div>
            )}

            {showLinkIcon && (
                <div
                    className="absolute bottom-1 right-1 w-6 h-6 flex items-center justify-center bg-blue-500 rounded-full cursor-pointer hover:bg-blue-600 transition-colors shadow-md z-10"
                    title="Create link from this node"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (data.onStartLinking) {
                            data.onStartLinking(data.original.id);
                        }
                    }}
                >
                    <Link2 size={14} className="text-white" />
                </div>
            )}

            {title && (
                <div className="font-bold text-gray-800 mb-2 truncate border-b border-black/10 pb-1">
                    {title}
                </div>
            )}

            <div className="text-sm text-gray-700 font-handwriting flex-1 overflow-hidden font-medium" style={{ fontFamily: '"Comic Sans MS", "Chalkboard SE", sans-serif' }}>
                {data.content}
            </div>

            <Handle type="source" position={Position.Bottom} className="w-16 opacity-0" />
        </div>
    );
};

const nodeTypes: NodeTypes = {
    text: TextNode,
    image: ImageNode,
    note: NoteNode,
};

interface GraphViewProps {
    data: { nodes: APINode[], edges: APIEdge[] };
    onNodeClick: (node: APINode) => void;
    selectedNodeId?: string;  // Externally selected node (e.g., from PDF click)
    onConnect?: (source: string, target: string) => void;
    onDeleteEdge?: (source: string, target: string) => void;
    hiddenTagNames?: Set<string>;
    hiddenPaperIds?: Set<number>;
    hiddenNoteIds?: Set<number>;
    onCreateNoteFromNode?: (nodeId: string) => void;
}

// Helper to darken hex color
const darkenColor = (hex: string, percent: number) => {
    let r = parseInt(hex.substring(1, 3), 16);
    let g = parseInt(hex.substring(3, 5), 16);
    let b = parseInt(hex.substring(5, 7), 16);

    r = Math.floor(r * (100 - percent) / 100);
    g = Math.floor(g * (100 - percent) / 100);
    b = Math.floor(b * (100 - percent) / 100);

    r = (r < 255) ? r : 255;
    g = (g < 255) ? g : 255;
    b = (b < 255) ? b : 255;

    const rr = ((r.toString(16).length === 1) ? "0" + r.toString(16) : r.toString(16));
    const gg = ((g.toString(16).length === 1) ? "0" + g.toString(16) : g.toString(16));
    const bb = ((b.toString(16).length === 1) ? "0" + b.toString(16) : b.toString(16));

    return "#" + rr + gg + bb;
};

const edgeTypes = {
    floating: FloatingEdge,
};

export const GraphView: React.FC<GraphViewProps> = ({ data, onNodeClick, selectedNodeId, onConnect, onDeleteEdge, hiddenTagNames, hiddenPaperIds, hiddenNoteIds, onCreateNoteFromNode }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const reactFlowInstance = React.useRef<any>(null);
    const [contextMenu, setContextMenu] = React.useState<{ id: string; source: string; target: string; x: number; y: number } | null>(null);
    const [linkCreationSource, setLinkCreationSource] = React.useState<string | null>(null);
    const [mousePosition, setMousePosition] = React.useState<{ x: number; y: number } | null>(null);

    const onConnectCallback = useCallback((params: Connection) => {
        if (onConnect && params.source && params.target) {
            onConnect(params.source, params.target);
        }
    }, [onConnect]);

    const handleStartLinking = useCallback((nodeId: string) => {
        console.log('Starting link creation from:', nodeId);
        setLinkCreationSource(nodeId);
    }, []);

    // Track mouse position for link preview
    const handleMouseMove = useCallback((event: React.MouseEvent) => {
        if (linkCreationSource && reactFlowInstance.current) {
            const bounds = event.currentTarget.getBoundingClientRect();
            const position = reactFlowInstance.current.project({
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
            });
            setMousePosition(position);
        }
    }, [linkCreationSource]);

    const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
        event.preventDefault();
        // Calculate position relative to the viewport or container?
        // event.clientX/Y are global.
        setContextMenu({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            x: event.clientX,
            y: event.clientY,
        });
    }, []);

    const onPaneClick = useCallback(() => {
        setContextMenu(null);
        // Cancel link creation if clicking on empty space
        if (linkCreationSource) {
            setLinkCreationSource(null);
            setMousePosition(null);
        }
    }, [linkCreationSource]);

    const handleDeleteEdge = () => {
        if (contextMenu && onDeleteEdge) {
            onDeleteEdge(contextMenu.source, contextMenu.target);
            setContextMenu(null);
        }
    };

    // Focus on selected node when selectedNodeId changes
    useEffect(() => {
        if (selectedNodeId && reactFlowInstance.current) {
            const node = nodes.find(n => n.id === selectedNodeId);
            if (node) {
                // Center the view on the selected node
                reactFlowInstance.current.fitView({
                    nodes: [{ id: selectedNodeId }],
                    duration: 800,
                    padding: 0.5,
                });

                // Bring the node to the front (highest z-index) by moving it to the end of the array
                // and temporarily highlight it
                setNodes(nds => {
                    const otherNodes = nds.filter(n => n.id !== selectedNodeId);
                    const selectedNodeObj = nds.find(n => n.id === selectedNodeId);
                    if (!selectedNodeObj) return nds;

                    return [
                        ...otherNodes.map(n => ({ ...n, className: '' })),
                        { ...selectedNodeObj, className: 'selected-node-highlight' }
                    ];
                });

                // Remove highlight after 2 seconds
                setTimeout(() => {
                    setNodes(nds => nds.map(n => ({
                        ...n,
                        className: ''
                    })));
                }, 2000);
            }
        }
    }, [selectedNodeId, nodes.length]);

    // Transform API data to React Flow format using PCA-based positions
    useEffect(() => {
        console.log(`GraphView useEffect triggered with ${data.nodes.length} nodes, ${data.edges.length} edges`);

        // Handle empty graph - clear everything
        if (!data.nodes.length) {
            console.log('Empty graph - clearing nodes and edges');
            setNodes([]);
            setEdges([]);
            return;
        }

        // Use PCA positions from backend (semantically meaningful placement)
        // Use PCA positions from backend (semantically meaningful placement)
        const initialNodes: Node[] = data.nodes
            .filter(node => {
                // Filter by tag visibility
                if (hiddenTagNames && hiddenTagNames.size > 0) {
                    if (node.tag_scores) {
                        // Check if node has high score for any hidden tag
                        for (const [tagName, score] of Object.entries(node.tag_scores)) {
                            if (hiddenTagNames.has(tagName) && score > 0.0) {
                                return false; // Hide if matches a hidden tag
                            }
                        }
                    }
                }

                // Filter by paper visibility (for text and image nodes)
                if (hiddenPaperIds && hiddenPaperIds.size > 0) {
                    if (node.type === 'text' || node.type === 'image') {
                        if (node.paper_id && hiddenPaperIds.has(node.paper_id)) {
                            return false; // Hide if paper is hidden
                        }
                    }
                }

                // Filter by note visibility (for note nodes)
                if (hiddenNoteIds && hiddenNoteIds.size > 0) {
                    if (node.type === 'note') {
                        // Extract note ID from node.id (format: "note_{id}")
                        const noteId = parseInt(node.id.replace('note_', ''));
                        if (!isNaN(noteId) && hiddenNoteIds.has(noteId)) {
                            return false; // Hide if note is hidden
                        }
                    }
                }

                return true;
            })
            .map((node) => ({
                id: node.id,
                type: node.type,
                position: node.position || { x: 0, y: 0 },  // Use PCA position from backend
                data: {
                    content: node.content,
                    page_number: node.page_number,
                    original: node,
                    onStartLinking: handleStartLinking,
                    onCreateNoteFromNode: onCreateNoteFromNode
                },
            }));

        // Create a set of visible node IDs for edge filtering
        const visibleNodeIds = new Set(initialNodes.map(n => n.id));

        // Create a map for quick node lookup
        const nodeMap = new Map<string, APINode>(data.nodes.map((n: APINode) => [n.id, n]));

        const newEdges: Edge[] = data.edges
            .filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
            .map((edge, index) => {
                let edgeColor = '#93c5fd'; // Default similarity color (though unused now)
                let strokeWidth = 1;
                let opacity = 0.6;

                if (edge.type === 'sequence') {
                    edgeColor = '#cbd5e1';
                    strokeWidth = 2;
                    opacity = 1;
                } else if (edge.type === 'manual') {
                    // Find the color of the note involved in the link
                    const sourceNode = nodeMap.get(edge.source);
                    const targetNode = nodeMap.get(edge.target);

                    let baseColor = '#ef4444';
                    // Prioritize note color
                    if (sourceNode?.type === 'note') {
                        baseColor = sourceNode.paper_color || '#ef4444';
                    } else if (targetNode?.type === 'note') {
                        baseColor = targetNode.paper_color || '#ef4444';
                    } else {
                        // Fallback to source color or default red
                        baseColor = sourceNode?.paper_color || '#ef4444';
                    }

                    // Darken the color by 20% for better visibility
                    try {
                        edgeColor = darkenColor(baseColor, 20);
                    } catch (e) {
                        edgeColor = baseColor;
                    }

                    strokeWidth = 3; // Bolder
                    opacity = 1.0; // Fully opaque
                } else {
                    // Similarity edges (if any remain)
                    strokeWidth = Math.max(1, edge.weight * 5);
                }

                return {
                    id: `e-${index}`,
                    source: edge.source,
                    target: edge.target,
                    type: 'floating',  // Use floating edges
                    animated: false,
                    style: {
                        stroke: edgeColor,
                        strokeWidth: strokeWidth,
                        opacity: opacity
                    },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: edgeColor,
                    },
                };
            });

        console.log(`Setting ${initialNodes.length} nodes and ${newEdges.length} edges (PCA-based layout)`);
        setNodes(initialNodes);
        setNodes(initialNodes);
        setEdges(newEdges);
    }, [data, setNodes, setEdges, hiddenTagNames, hiddenPaperIds, hiddenNoteIds]);

    // Add temporary preview edge during link creation
    useEffect(() => {
        if (linkCreationSource && mousePosition && nodes.length > 0) {
            const sourceNode = nodes.find(n => n.id === linkCreationSource);
            if (sourceNode) {
                // Find the original node data to get color
                const originalNode = data.nodes.find(n => n.id === linkCreationSource);
                const edgeColor = originalNode?.paper_color ? darkenColor(originalNode.paper_color, 20) : '#3B82F6';

                const previewEdge: Edge = {
                    id: 'preview-edge',
                    source: linkCreationSource,
                    target: 'preview-target',
                    type: 'default',
                    animated: true,
                    style: {
                        stroke: edgeColor,
                        strokeWidth: 3,
                        opacity: 0.6,
                        strokeDasharray: '5,5'
                    },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: edgeColor,
                    },
                };

                // Create a temporary invisible target node at mouse position
                const previewTargetNode: Node = {
                    id: 'preview-target',
                    type: 'default',
                    position: mousePosition,
                    data: {},
                    draggable: false,
                    selectable: false,
                    connectable: false,
                    style: {
                        opacity: 0,
                        width: 1,
                        height: 1,
                        pointerEvents: 'none' // Critical: prevents blocking clicks on real nodes
                    },
                };

                setNodes(nds => {
                    const filtered = nds.filter(n => n.id !== 'preview-target');
                    return [...filtered, previewTargetNode];
                });

                setEdges(eds => {
                    const filtered = eds.filter(e => e.id !== 'preview-edge');
                    return [...filtered, previewEdge];
                });
            }
        } else {
            // Remove preview edge and node when not in link creation mode
            setNodes(nds => nds.filter(n => n.id !== 'preview-target'));
            setEdges(eds => eds.filter(e => e.id !== 'preview-edge'));
        }
    }, [linkCreationSource, mousePosition, nodes.length, data.nodes]);

    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        // If in link creation mode, complete the link
        if (linkCreationSource) {
            // Only allow linking to text nodes
            if (node.data.original.type !== 'text') {
                console.log('Links can only be created to text nodes');
                setLinkCreationSource(null);
                setMousePosition(null);
                return;
            }

            if (linkCreationSource !== node.id && onConnect) {
                onConnect(linkCreationSource, node.id);
            }
            setLinkCreationSource(null);
            setMousePosition(null);
            return;
        }
        onNodeClick(node.data.original);
    }, [onNodeClick, linkCreationSource, onConnect]);

    // Visual feedback for link creation mode
    useEffect(() => {
        if (linkCreationSource) {
            setNodes(nds => nds.map(n => {
                // Highlight source node
                if (n.id === linkCreationSource) {
                    return {
                        ...n,
                        className: 'ring-4 ring-blue-500 ring-opacity-50'
                    };
                }
                // Highlight valid target nodes (text nodes only)
                if (n.data.original.type === 'text') {
                    return {
                        ...n,
                        className: 'ring-2 ring-green-400 ring-opacity-30'
                    };
                }
                return n;
            }));
        } else {
            setNodes(nds => nds.map(n => ({
                ...n,
                className: ''
            })));
        }
    }, [linkCreationSource]);

    return (
        <div className="w-full h-full bg-gray-50">
            <ReactFlow
                key={JSON.stringify(data.nodes.map(n => n.id))}
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                onConnect={onConnectCallback}
                onEdgeContextMenu={onEdgeContextMenu}
                onPaneClick={onPaneClick}
                onMouseMove={handleMouseMove}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onInit={(instance) => { reactFlowInstance.current = instance; }}
                fitView
                fitViewOptions={{ padding: 0.2, duration: 800 }}
                minZoom={0.05}
                maxZoom={2}
            >
                <Background color="#e2e8f0" gap={16} />
                <Controls />
            </ReactFlow>
            {
                contextMenu && (
                    <div
                        style={{
                            position: 'fixed',
                            top: contextMenu.y,
                            left: contextMenu.x,
                            zIndex: 1000,
                        }}
                        className="bg-white shadow-lg rounded-md border border-gray-200 py-1 min-w-[120px]"
                    >
                        <button
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                            onClick={handleDeleteEdge}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18"></path>
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                            </svg>
                            Delete Link
                        </button>
                    </div>
                )
            }
        </div>
    );
};
