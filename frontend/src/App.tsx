import { useState } from 'react';
import { ProjectList } from './components/ProjectList';
import { GraphView } from './components/GraphView';
import { PapersSidebar } from './components/PapersSidebar';
import { api } from './api';
import type { Project, GraphData } from './api';
import { ArrowLeft, Network } from 'lucide-react';

type View = 'projects' | 'graph';

function App() {
  const [currentView, setCurrentView] = useState<View>('projects');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);

  const handleSelectProject = async (project: Project) => {
    setSelectedProject(project);
    try {
      const data = await api.getGraph(project.id);
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
      const data = await api.getGraph(selectedProject.id);
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
      const data = await api.getGraph(selectedProject.id);
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
  };

  const handleNodeClick = (node: any) => {
    console.log('Node clicked:', node);
    // Future: show node details in a modal or sidebar
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
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
      <main className="max-w-7xl mx-auto px-6 py-8">
        {currentView === 'projects' && (
          <ProjectList onSelectProject={handleSelectProject} />
        )}

        {currentView === 'graph' && graphData && selectedProject && (
          <div className="h-[calc(100vh-12rem)] relative">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 h-full overflow-hidden">
              <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">Knowledge Graph</h2>
                    <p className="text-sm text-gray-600">
                      {graphData.nodes.length} nodes · {graphData.edges.length} connections
                    </p>
                  </div>
                </div>
              </div>
              <div className="h-[calc(100%-5rem)] relative">
                <GraphView data={graphData} onNodeClick={handleNodeClick} />
                {/* Floating Papers Sidebar */}
                <PapersSidebar
                  projectId={selectedProject.id}
                  onUploadComplete={handleUploadComplete}
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
