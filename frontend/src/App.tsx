import { useState } from 'react';
import { ProjectList } from './components/ProjectList';
import { GraphView } from './components/GraphView';
import { PapersSidebar } from './components/PapersSidebar';
import { PDFViewer } from './components/PDFViewer';
import { AdvancedViewPanel } from './components/AdvancedViewPanel';
import { TagsPanel } from './components/TagsPanel';

import { api } from './api';
import type { Project, GraphData, Node } from './api';
import { ArrowLeft, Network } from 'lucide-react';

type View = 'projects' | 'graph';

function App() {
  const [currentView, setCurrentView] = useState<View>('projects');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [useNewEmbeddings, setUseNewEmbeddings] = useState<boolean>(false);

  const handleSelectProject = async (project: Project) => {
    setSelectedProject(project);
    try {
      const data = await api.getGraph(project.id, useNewEmbeddings);
      setGraphData(data);
      setCurrentView('graph');
    } catch (error) {
      console.error('Failed to load graph:', error);
      // If no graph exists yet, show empty graph
      setGraphData({ nodes: [], edges: [] });
      setCurrentView('graph');
    }
  };

  const handleUploadComplete = async () => {
    if (!selectedProject) return;

    console.log('Refreshing graph after paper deletion/upload...');
    try {
      const data = await api.getGraph(selectedProject.id, useNewEmbeddings);
      console.log(`Received graph data: ${data.nodes.length} nodes, ${data.edges.length} edges`);
      setGraphData(data);
      setCurrentView('graph');
    } catch (error) {
      console.error('Failed to load graph:', error);
    }
  };

  const handleViewGraph = async () => {
    if (!selectedProject) return;

    try {
      const data = await api.getGraph(selectedProject.id, useNewEmbeddings);
      setGraphData(data);
      setCurrentView('graph');
    } catch (error) {
      console.error('Failed to load graph:', error);
    }
  };

  const handleBackToProjects = () => {
    setCurrentView('projects');
    setSelectedProject(null);
    setGraphData(null);
    setSelectedNode(null);
  };

  const handleNodeClick = (node: any) => {
    console.log('Node clicked:', node);
    // The node object from React Flow puts the original data in node.data.original
    // But our GraphView passes the API node directly to onNodeClick
    // Let's check what we get.
    // In GraphView.tsx: onNodeClick(node.data.original)
    // So we get the raw API Node object.
    setSelectedNode(node);
  };

  const handleToggleEmbeddings = async (useNew: boolean) => {
    setUseNewEmbeddings(useNew);
    if (!selectedProject) return;

    // Refresh graph with new embedding setting
    try {
      const data = await api.getGraph(selectedProject.id, useNew);
      setGraphData(data);
    } catch (error) {
      console.error('Failed to reload graph:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-full mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {currentView !== 'projects' && (
                <button
                  onClick={handleBackToProjects}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ArrowLeft size={20} className="text-gray-600" />
                </button>
              )}
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Paper Explorer
              </h1>
            </div>

            {selectedProject && (
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm text-gray-500">Current Project</p>
                  <p className="font-semibold text-gray-800">{selectedProject.name}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w mx-auto px-20 py-8">
        {currentView === 'projects' && (
          <ProjectList onSelectProject={handleSelectProject} />
        )}

        {currentView === 'graph' && graphData && selectedProject && (
          <div className="h-[calc(100vh-12rem)] relative">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 h-full overflow-hidden flex">
              {/* Graph View - Left Side */}
              <div
                className={`border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 flex flex-col transition-all duration-300 ${selectedNode ? 'w-1/2' : 'w-full'
                  }`}
              >
                <div className="p-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-gray-800">Knowledge Graph</h2>
                      <p className="text-sm text-gray-600">
                        {graphData.nodes.length} nodes · {graphData.edges.length} connections
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 relative overflow-hidden">
                  <GraphView data={graphData} onNodeClick={handleNodeClick} />
                  {/* Floating Advanced View Panel */}
                  <AdvancedViewPanel
                    projectId={selectedProject.id}
                    useNewEmbeddings={useNewEmbeddings}
                    onToggleEmbeddings={handleToggleEmbeddings}
                  />
                  {/* Floating Papers Sidebar */}
                  <PapersSidebar
                    projectId={selectedProject.id}
                    onUploadComplete={handleUploadComplete}
                  />
                  {/* Floating Tags Panel */}
                  <TagsPanel
                    projectId={selectedProject.id}
                    onNodeClick={handleNodeClick}
                  />
                </div>
              </div>


              {/* PDF Viewer - Right Side */}
              {selectedNode && (
                <div className="flex-1 animate-in slide-in-from-right duration-300">
                  <PDFViewer
                    node={selectedNode}
                    onClose={() => setSelectedNode(null)}
                    projectId={selectedProject.id}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
