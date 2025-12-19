import { useState, useEffect } from 'react';
import { ProjectList } from './components/ProjectList';
import { GraphView } from './components/GraphView';
import { PapersSidebar } from './components/PapersSidebar';
import { PDFViewer } from './components/PDFViewer';
import { AdvancedViewPanel } from './components/AdvancedViewPanel';
import { TagsPanel } from './components/TagsPanel';
import NoteModal from './components/NoteModal';
import EditProjectModal from './components/EditProjectModal';
import { DiscoveryPanel } from './components/DiscoveryPanel';

import { api } from './api';
import type { Project, GraphData, Node, Note } from './api';
import { ArrowLeft, Network, Edit2 } from 'lucide-react';

type View = 'projects' | 'graph';

function App() {
  const [currentView, setCurrentView] = useState<View>('projects');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [useNewEmbeddings, setUseNewEmbeddings] = useState<boolean>(false);
  const [tagRefreshKey, setTagRefreshKey] = useState<number>(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [hiddenTagNames, setHiddenTagNames] = useState<Set<string>>(new Set());
  const [hiddenPaperIds, setHiddenPaperIds] = useState<Set<number>>(new Set());
  const [hiddenNoteIds, setHiddenNoteIds] = useState<Set<number>>(new Set());

  // Editing Project State
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  // Reset hidden tags, papers, and notes when project changes
  useEffect(() => {
    setHiddenTagNames(new Set());
    setHiddenPaperIds(new Set());
    setHiddenNoteIds(new Set());
  }, [selectedProject?.id]);

  // Sync selectedNode with graphData updates to ensure tag_scores are fresh
  useEffect(() => {
    if (selectedNode && graphData) {
      const updatedNode = graphData.nodes.find((n: Node) => n.id === selectedNode.id);
      if (updatedNode && updatedNode !== selectedNode) {
        setSelectedNode(updatedNode);
      }
    }
  }, [graphData]);

  // Note State
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);
  const [noteSourceNodeId, setNoteSourceNodeId] = useState<string | null>(null);

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
      // If useNewEmbeddings is enabled, recompute embeddings first
      if (useNewEmbeddings) {
        console.log('Recomputing new embeddings after paper upload...');
        await api.computeNewEmbeddings(selectedProject.id, useGlobalContext);
      }

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

    if (node.type === 'note') {
      // Map API node to Note object for editing
      // The node from graph has: id, type, content, paper_color, etc.
      // We need to construct a Note-like object or fetch the full note.
      // Since we have the content and color in the node, we can use that.
      // But we need the numeric ID for updates.
      // The node ID in graph is "note_{id}".
      const noteId = parseInt(node.id.replace('note_', ''));

      const noteForEdit: Note = {
        id: noteId,
        project_id: selectedProject?.id || 0,
        title: node.title,
        content: node.content,
        color: node.paper_color || '#FEF3C7',
        created_at: '', // Not needed for edit
        updated_at: ''
      };

      setEditingNote(noteForEdit);
      setIsNoteModalOpen(true);
    } else {
      setSelectedNode(node);
    }
  };

  const handleTagsUpdated = async () => {
    // Increment the key to force TagsPanel to refresh
    setTagRefreshKey(prev => prev + 1);

    // Also refresh the graph to update has_tags status
    if (selectedProject) {
      try {
        if (automaticRefresh) {
          await handleComputeAndRefresh();
        } else {
          await handleRefreshView();
        }
      } catch (error) {
        console.error('Failed to refresh graph after tag update:', error);
      }
    }
  };

  const handlePDFClick = (nodeId: string) => {
    // Find the node in the graph data
    if (!graphData) return;

    const node = graphData.nodes.find(n => n.id === nodeId);
    if (node) {
      console.log('PDF click - selecting node:', nodeId);
      setSelectedNode(node);
      setSelectedNodeId(nodeId);  // Trigger graph focus
    }
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

  const [useGlobalContext, setUseGlobalContext] = useState(false);
  const [automaticRefresh, setAutomaticRefresh] = useState(false);

  const handleRefreshView = async () => {
    if (!selectedProject) return;
    try {
      const data = await api.getGraph(selectedProject.id, useNewEmbeddings);
      setGraphData(data);
      return { status: 'success', message: 'View refreshed' };
    } catch (error) {
      console.error('Failed to refresh view:', error);
      throw error;
    }
  };

  const handleComputeAndRefresh = async () => {
    if (!selectedProject) return;
    try {
      await api.computeNewEmbeddings(selectedProject.id, useGlobalContext);
      await handleRefreshView();
    } catch (error) {
      console.error('Failed to compute and refresh:', error);
      throw error;
    }
  };

  const handleToggleGlobalContext = async (useGlobal: boolean) => {
    setUseGlobalContext(useGlobal);
    // When toggling global context, we should recompute embeddings immediately
    if (selectedProject) {
      // We need to pass the NEW value of useGlobal, not the state which might be stale
      try {
        await api.computeNewEmbeddings(selectedProject.id, useGlobal);
        await handleRefreshView();
      } catch (error) {
        console.error('Failed to update global context:', error);
      }
    }
  };

  const handleToggleTagVisibility = (tagName: string) => {
    setHiddenTagNames((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(tagName)) {
        next.delete(tagName);
      } else {
        next.add(tagName);
      }
      return next;
    });
  };

  const handleTogglePaperVisibility = (paperId: number) => {
    setHiddenPaperIds((prev: Set<number>) => {
      const next = new Set(prev);
      if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }
      return next;
    });
  };

  const handleToggleNoteVisibility = (noteId: number) => {
    setHiddenNoteIds((prev: Set<number>) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  };

  // Note Handlers
  const handleSaveNote = async (title: string, content: string, color: string) => {
    if (!selectedProject) return;

    try {
      let createdOrUpdatedNote: Note;
      if (editingNote) {
        createdOrUpdatedNote = await api.updateNote(editingNote.id, { title, content, color });
      } else {
        createdOrUpdatedNote = await api.createNote(selectedProject.id, title, content, color);

        // If note was created from a node, create automatic link
        if (noteSourceNodeId) {
          const noteNodeId = `note_${createdOrUpdatedNote.id}`;
          await api.createLink(noteNodeId, noteSourceNodeId, 'manual');
          setNoteSourceNodeId(null); // Clear after linking
        }
      }

      // Refresh everything
      setSidebarRefreshTrigger(prev => prev + 1);

      // We no longer need to manually recompute embeddings here because 
      // the backend now handles single-node score computation on create/update.

      await handleRefreshView();

    } catch (error) {
      console.error('Failed to save note:', error);
      alert('Failed to save note. Please try again.');
      throw error;
    }
  };

  const handleAddNote = () => {
    setEditingNote(null);
    setNoteSourceNodeId(null); // Clear any source node
    setIsNoteModalOpen(true);
  };

  const handleEditNote = (note: Note) => {
    setEditingNote(note);
    setNoteSourceNodeId(null); // Clear source node when editing
    setIsNoteModalOpen(true);
  };

  const handleCreateNoteFromNode = (nodeId: string) => {
    setEditingNote(null); // New note
    setNoteSourceNodeId(nodeId); // Store source node for linking
    setIsNoteModalOpen(true);
  };

  const handleCreateLink = async (source: string, target: string) => {
    if (!selectedProject) return;
    try {
      await api.createLink(source, target);
      // Refresh graph to show new link
      await handleRefreshView();
    } catch (error) {
      console.error('Failed to create link:', error);
    }
  };

  const handleDeleteEdge = async (source: string, target: string) => {
    if (!selectedProject) return;
    try {
      await api.deleteLink(source, target);
      // Refresh graph to remove link
      await handleRefreshView();
    } catch (error) {
      console.error('Failed to delete link:', error);
    }
  };

  const handleProjectUpdated = (updatedProject: Project) => {
    setSelectedProject(updatedProject);
    setEditingProject(null);
  }

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
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">{selectedProject.name}</p>
                    <button
                      onClick={() => setEditingProject(selectedProject)}
                      className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-blue-600 transition-colors"
                    >
                      <Edit2 size={14} />
                    </button>
                  </div>
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
                  <GraphView
                    data={graphData}
                    onNodeClick={handleNodeClick}
                    selectedNodeId={selectedNodeId}
                    onConnect={handleCreateLink}
                    onDeleteEdge={handleDeleteEdge}
                    hiddenTagNames={hiddenTagNames}
                    hiddenPaperIds={hiddenPaperIds}
                    hiddenNoteIds={hiddenNoteIds}
                    onCreateNoteFromNode={handleCreateNoteFromNode}
                  />
                  {/* Floating Advanced View Panel */}
                  <AdvancedViewPanel
                    projectId={selectedProject.id}
                    useNewEmbeddings={useNewEmbeddings}
                    onToggleEmbeddings={handleToggleEmbeddings}
                    useGlobalContext={useGlobalContext}
                    onToggleGlobalContext={handleToggleGlobalContext}
                    automaticRefresh={automaticRefresh}
                    onToggleAutomaticRefresh={setAutomaticRefresh}
                    onRefreshView={handleRefreshView}
                  />
                  {/* Floating Papers Sidebar */}
                  <PapersSidebar
                    projectId={selectedProject.id}
                    onUploadComplete={handleUploadComplete}
                    onEditNote={handleEditNote}
                    onAddNote={handleAddNote}
                    refreshTrigger={sidebarRefreshTrigger}
                    hiddenPaperIds={hiddenPaperIds}
                    hiddenNoteIds={hiddenNoteIds}
                    onTogglePaperVisibility={handleTogglePaperVisibility}
                    onToggleNoteVisibility={handleToggleNoteVisibility}
                  />
                  {/* Floating Tags Panel */}
                  <TagsPanel
                    key={tagRefreshKey}
                    projectId={selectedProject.id}
                    onNodeClick={handleNodeClick}
                    hiddenTagNames={hiddenTagNames}
                    onToggleTagVisibility={handleToggleTagVisibility}
                  />

                  <DiscoveryPanel projectId={selectedProject.id} />

                  <NoteModal
                    isOpen={isNoteModalOpen}
                    onClose={() => {
                      setIsNoteModalOpen(false);
                      setEditingNote(null);
                    }}
                    onSave={handleSaveNote}
                    initialNote={editingNote}
                    onViewNode={handleNodeClick}
                    useNewEmbeddings={useNewEmbeddings}
                    onLinksChanged={handleRefreshView}
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
                    onTagsUpdated={handleTagsUpdated}
                    onPDFClick={handlePDFClick}
                    allNodes={graphData.nodes}
                    onCreateNoteFromNode={handleCreateNoteFromNode}
                    activeNote={editingNote}
                    isLinked={!!(editingNote && graphData.edges.some(e =>
                      (e.source === selectedNode.id && e.target === `note_${editingNote.id}`) ||
                      (e.target === selectedNode.id && e.source === `note_${editingNote.id}`)
                    ))}
                    onConnectToNote={async (nodeId: string, noteId: number) => {

                      if (!selectedProject) return;
                      try {
                        // noteId is number, createLink expects "note_{id}" string for target usually?
                        // Wait, api.createLink signature: (sourceId, targetId, type?)
                        // We want to link PDF Node (nodeId) -> Note Node ("note_"+noteId)
                        await api.createLink(nodeId, `note_${noteId}`, 'manual');
                        await handleRefreshView();
                      } catch (error) {
                        console.error('Failed to connect note:', error);
                      }
                    }}
                  />

                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {editingProject && (
        <EditProjectModal
          isOpen={!!editingProject}
          onClose={() => setEditingProject(null)}
          onSave={handleProjectUpdated}
          project={editingProject}
        />
      )}
    </div>
  );
}

export default App;
