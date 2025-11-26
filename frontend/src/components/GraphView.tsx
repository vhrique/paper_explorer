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
    return (
        <div className="px-4 py-2 shadow-md rounded-md bg-white w-64" style={{ borderWidth: '2px', borderStyle: 'solid', borderColor }}>
            <Handle type="target" position={Position.Top} className="w-16" style={{ background: borderColor }} />
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
    return (
        <div className="shadow-md rounded-md bg-white p-1" style={{ borderWidth: '2px', borderStyle: 'solid', borderColor }}>
            <Handle type="target" position={Position.Top} className="w-16" style={{ background: borderColor }} />
            <img
                src={`/api/static/images/${data.content}`}
                alt="Extracted"
                className="w-32 h-auto rounded-sm"
            />
            <div className="text-[10px] text-center mt-1 text-gray-500">Page {data.page_number}</div>
            <Handle type="source" position={Position.Bottom} className="w-16" style={{ background: borderColor }} />
        </div>
    );
};

const nodeTypes: NodeTypes = {
    text: TextNode,
    image: ImageNode,
};

interface GraphViewProps {
    data: { nodes: APINode[], edges: APIEdge[] };
    onNodeClick: (node: APINode) => void;
}

export const GraphView: React.FC<GraphViewProps> = ({ data, onNodeClick }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

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

        const newEdges: Edge[] = data.edges.map((edge, index) => ({
            id: `e-${index}`,
            source: edge.source,
            target: edge.target,
            type: edge.type === 'sequence' ? 'default' : 'straight',
            animated: edge.type === 'sequence',
            style: {
                stroke: edge.type === 'sequence' ? '#cbd5e1' : '#93c5fd',
                strokeWidth: edge.type === 'sequence' ? 2 : Math.max(1, edge.weight * 5),
                opacity: edge.type === 'sequence' ? 1 : 0.6
            },
            markerEnd: {
                type: MarkerType.ArrowClosed,
                color: edge.type === 'sequence' ? '#cbd5e1' : '#93c5fd',
            },
        }));

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
