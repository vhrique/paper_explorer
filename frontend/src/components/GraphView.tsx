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
import type { Node, Edge, NodeTypes } from 'reactflow';
import 'reactflow/dist/style.css';
import type { Node as APINode, Edge as APIEdge } from '../api';

// Custom Node Components
const TextNode = ({ data }: any) => {
    const borderColor = data.original?.paper_color || '#3B82F6';
    const hasTags = data.original?.has_tags || false;

    return (
        <div className="px-4 py-2 shadow-md rounded-md bg-white w-64 relative" style={{ borderWidth: '2px', borderStyle: 'solid', borderColor }}>
            <Handle type="target" position={Position.Top} className="w-16" style={{ background: borderColor }} />
            {hasTags && (
                <div className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center" title="Has tags">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-500">
                        <path fillRule="evenodd" d="M5.5 3A2.5 2.5 0 003 5.5v2.879a2.5 2.5 0 00.732 1.767l6.5 6.5a2.5 2.5 0 003.536 0l2.878-2.878a2.5 2.5 0 000-3.536l-6.5-6.5A2.5 2.5 0 008.38 3H5.5zM6 7a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                    </svg>
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

    return (
        <div className="shadow-md rounded-md bg-white p-1 relative" style={{ borderWidth: '2px', borderStyle: 'solid', borderColor }}>
            <Handle type="target" position={Position.Top} className="w-16" style={{ background: borderColor }} />
            {hasTags && (
                <div className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center z-10" title="Has tags">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-500">
                        <path fillRule="evenodd" d="M5.5 3A2.5 2.5 0 003 5.5v2.879a2.5 2.5 0 00.732 1.767l6.5 6.5a2.5 2.5 0 003.536 0l2.878-2.878a2.5 2.5 0 000-3.536l-6.5-6.5A2.5 2.5 0 008.38 3H5.5zM6 7a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                    </svg>
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

    return (
        <div
            className="shadow-lg rounded-sm p-4 w-48 h-48 relative flex flex-col transform hover:scale-105 transition-transform"
            style={{
                backgroundColor: bgColor,
                boxShadow: '2px 2px 5px rgba(0,0,0,0.1)'
            }}
        >
            <Handle type="target" position={Position.Top} className="w-16 opacity-0" />

            {hasTags && (
                <div className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center" title="Has tags">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-500">
                        <path fillRule="evenodd" d="M5.5 3A2.5 2.5 0 003 5.5v2.879a2.5 2.5 0 00.732 1.767l6.5 6.5a2.5 2.5 0 003.536 0l2.878-2.878a2.5 2.5 0 000-3.536l-6.5-6.5A2.5 2.5 0 008.38 3H5.5zM6 7a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                    </svg>
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

export const GraphView: React.FC<GraphViewProps> = ({ data, onNodeClick, selectedNodeId }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const reactFlowInstance = React.useRef<any>(null);

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

                // Temporarily highlight the node
                setNodes(nds => nds.map(n => ({
                    ...n,
                    className: n.id === selectedNodeId ? 'selected-node-highlight' : ''
                })));

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
        const initialNodes: Node[] = data.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            position: node.position || { x: 0, y: 0 },  // Use PCA position from backend
            data: {
                content: node.content,
                page_number: node.page_number,
                original: node
            },
        }));

        // Create a map for quick node lookup
        const nodeMap = new Map<string, APINode>(data.nodes.map((n: APINode) => [n.id, n]));

        const newEdges: Edge[] = data.edges.map((edge, index) => {
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
                type: edge.type === 'sequence' ? 'default' : 'straight',
                animated: edge.type === 'sequence',
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
        setEdges(newEdges);
    }, [data, setNodes, setEdges]);

    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        onNodeClick(node.data.original);
    }, [onNodeClick]);

    return (
        <div className="w-full h-full bg-gray-50">
            <ReactFlow
                key={JSON.stringify(data.nodes.map(n => n.id))}
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                nodeTypes={nodeTypes}
                onInit={(instance) => { reactFlowInstance.current = instance; }}
                fitView
                fitViewOptions={{ padding: 0.2, duration: 800 }}
                minZoom={0.05}
                maxZoom={2}
            >
                <Background color="#e2e8f0" gap={16} />
                <Controls />
            </ReactFlow>
        </div>
    );
};
