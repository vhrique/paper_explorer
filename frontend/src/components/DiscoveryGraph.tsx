import React, { useCallback, useEffect } from 'react';
import ReactFlow, {
    Background,
    Controls,
    useNodesState,
    useEdgesState,
    MarkerType,
    type Node,
    type Edge,
    type NodeTypes,
    Handle,
    Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Node as APINode, Edge as APIEdge } from '../api';
import { PaperCard } from './PaperCard';
import FloatingEdge from './FloatingEdge';

const NodeComponent = ({ data }: any) => {
    const { title, paper_color, type, year, authors } = data;

    // Size based on type? Project papers bigger?
    const isProject = type === 'project';
    const size = isProject ? 'w-48' : 'w-40';

    return (
        <div
            className={`${size} bg-white rounded-lg shadow-md border-2 hover:shadow-lg transition-shadow relative overflow-hidden`}
            style={{ borderColor: paper_color }}
        >
            <div className={`h-2 w-full`} style={{ backgroundColor: paper_color }}></div>
            <div className="p-3">
                <h3 className="text-xs font-bold text-gray-800 line-clamp-3 mb-1" title={title}>
                    {title}
                </h3>
                <div className="flex flex-wrap gap-1 text-[10px] text-gray-500">
                    {year && <span className="bg-gray-100 px-1 rounded">{year}</span>}
                    {type !== 'project' && (
                        <span className={`px-1 rounded text-white ${type === 'reference' ? 'bg-green-500' : 'bg-orange-500'}`}>
                            {type === 'reference' ? 'Ref' : 'Cit'}
                        </span>
                    )}
                </div>
            </div>

            <Handle type="target" position={Position.Top} className="opacity-0" />
            <Handle type="source" position={Position.Bottom} className="opacity-0" />
        </div>
    );
};

const nodeTypes: NodeTypes = {
    project: NodeComponent,
    reference: NodeComponent,
    citation: NodeComponent,
};

const edgeTypes = {
    floating: FloatingEdge,
};

export const DiscoveryGraph: React.FC<DiscoveryGraphProps> = ({ data }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [selectedNode, setSelectedNode] = React.useState<any | null>(null);

    useEffect(() => {
        if (!data.nodes.length) return;

        const newNodes: Node[] = data.nodes.map((node) => ({
            id: node.id,
            type: node.type, // 'project', 'reference', 'citation' - mapped to NodeComponent
            position: node.position || { x: 0, y: 0 },
            data: {
                title: node.title,
                paper_color: node.paper_color,
                type: node.type,
                year: node.year,
                authors: node.authors,
                url: node.url,
                abstract: node.abstract // Pass through abstract
            },
        }));

        const newEdges: Edge[] = data.edges.map((edge, i) => ({
            id: `e-${i}`,
            source: edge.source,
            target: edge.target,
            type: 'floating',
            animated: edge.type === 'reference', // animate outgoing references? or maybe citations
            style: {
                stroke: edge.type === 'reference' ? '#22c55e' : (edge.type === 'citation' ? '#f97316' : '#94a3b8'),
                strokeWidth: 1.5,
                opacity: 0.6
            },
            markerEnd: {
                type: MarkerType.ArrowClosed,
                color: edge.type === 'reference' ? '#22c55e' : (edge.type === 'citation' ? '#f97316' : '#94a3b8'),
            },
        }));

        setNodes(newNodes);
        setEdges(newEdges);
    }, [data, setNodes, setEdges]);

    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        event.stopPropagation();
        setSelectedNode(node.data);
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
    }, []);

    return (
        <div className="w-full h-full bg-gray-50 relative">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                fitView
                minZoom={0.1}
            >
                <Background color="#e2e8f0" gap={20} />
                <Controls />
            </ReactFlow>

            {/* Selected Node Card Overlay */}
            {selectedNode && (
                <div className="absolute top-4 right-4 w-80 z-20 animate-in fade-in slide-in-from-right-4 duration-200">
                    <PaperCard
                        title={selectedNode.title}
                        abstract={selectedNode.abstract}
                        authors={selectedNode.authors}
                        year={selectedNode.year}
                        url={selectedNode.url}
                        onClose={() => setSelectedNode(null)}
                        compact={true}
                        className="shadow-xl border-indigo-100"
                    />
                </div>
            )}
        </div>
    );
};
