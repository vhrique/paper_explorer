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

    // Transform API data to React Flow format with Force Directed Layout
    useEffect(() => {
        console.log(`GraphView useEffect triggered with ${data.nodes.length} nodes, ${data.edges.length} edges`);

        // Handle empty graph - clear everything
        if (!data.nodes.length) {
            console.log('Empty graph - clearing nodes and edges');
            setNodes([]);
            setEdges([]);
            return;
        }

        // Use force-directed layout based on the edges
        const width = 4000;  // Increased for more space
        const height = 4000;

        // Create initial positions
        const initialNodes: Node[] = data.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            position: {
                x: Math.random() * width - width / 2,
                y: Math.random() * height - height / 2
            },
            data: {
                content: node.content,
                page_number: node.page_number,
                original: node
            },
        }));

        // Simple force-directed positioning
        // Apply forces: similarity edges pull nodes together, sequential edges create flow
        const iterations = 100;
        const nodePositions = new Map(initialNodes.map(n => [n.id, { ...n.position }]));

        for (let iter = 0; iter < iterations; iter++) {
            const forces = new Map(initialNodes.map(n => [n.id, { x: 0, y: 0 }]));

            // Repulsion between all nodes (anti-gravity) - INCREASED
            for (let i = 0; i < initialNodes.length; i++) {
                for (let j = i + 1; j < initialNodes.length; j++) {
                    const pos1 = nodePositions.get(initialNodes[i].id)!;
                    const pos2 = nodePositions.get(initialNodes[j].id)!;
                    const dx = pos1.x - pos2.x;
                    const dy = pos1.y - pos2.y;
                    const distSq = dx * dx + dy * dy;
                    const dist = Math.sqrt(distSq);

                    // Avoid division by zero - add minimum distance
                    if (dist < 1) continue;

                    const repulsion = 20000 / distSq;  // Use distSq to avoid another division

                    const fx = (dx / dist) * repulsion;
                    const fy = (dy / dist) * repulsion;

                    // Check for NaN before applying
                    if (!isNaN(fx) && !isNaN(fy)) {
                        forces.get(initialNodes[i].id)!.x += fx;
                        forces.get(initialNodes[i].id)!.y += fy;
                        forces.get(initialNodes[j].id)!.x -= fx;
                        forces.get(initialNodes[j].id)!.y -= fy;
                    }
                }
            }

            // Attraction along edges
            data.edges.forEach(edge => {
                const pos1 = nodePositions.get(edge.source);
                const pos2 = nodePositions.get(edge.target);
                if (!pos1 || !pos2) return;

                const dx = pos2.x - pos1.x;
                const dy = pos2.y - pos1.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Avoid division by zero
                if (dist < 0.1) return;

                // Stronger attraction for similarity edges
                const strength = edge.type === 'similarity' ? edge.weight * 0.5 : 0.05;
                const attraction = dist * strength;

                const fx = (dx / dist) * attraction;
                const fy = (dy / dist) * attraction;

                // Check for NaN before applying
                if (!isNaN(fx) && !isNaN(fy)) {
                    forces.get(edge.source)!.x += fx;
                    forces.get(edge.source)!.y += fy;
                    forces.get(edge.target)!.x -= fx;
                    forces.get(edge.target)!.y -= fy;
                }
            });

            // Apply forces with damping
            const damping = 0.5;
            initialNodes.forEach(node => {
                const force = forces.get(node.id)!;
                const pos = nodePositions.get(node.id)!;

                // Apply forces only if they're valid numbers
                if (!isNaN(force.x) && !isNaN(force.y)) {
                    pos.x += force.x * damping;
                    pos.y += force.y * damping;

                    // Clamp to reasonable bounds to prevent explosion
                    pos.x = Math.max(-10000, Math.min(10000, pos.x));
                    pos.y = Math.max(-10000, Math.min(10000, pos.y));
                }
            });
        }

        // Update node positions
        const positionedNodes = initialNodes.map(node => ({
            ...node,
            position: nodePositions.get(node.id)!
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

        console.log(`Setting ${positionedNodes.length} nodes and ${newEdges.length} edges`);
        setNodes(positionedNodes);
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
