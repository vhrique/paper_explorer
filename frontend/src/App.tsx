import { useState } from 'react';
import { ProjectsView } from './components/ProjectsView';
import { ProjectView } from './components/ProjectView';
import { ReaderView } from './components/ReaderView';
import type { Paper, Project } from './api';

type View = 'projects' | 'project' | 'reader';

function App() {
  const [view, setView] = useState<View>('projects');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);

  const handleSelectProject = (project: Project) => {
    setSelectedProject(project);
    setView('project');
  };

  const handleOpenPaper = (paper: Paper) => {
    setSelectedPaper(paper);
    setView('reader');
  };

  if (view === 'reader' && selectedPaper && selectedProject) {
    return (
      <ReaderView
        paper={selectedPaper}
        project={selectedProject}
        onBack={() => setView('project')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-lg font-bold text-gray-900 tracking-tight">Paper Explorer</h1>
      </header>
      <main>
        {view === 'projects' && (
          <ProjectsView onSelect={handleSelectProject} />
        )}
        {view === 'project' && selectedProject && (
          <ProjectView
            project={selectedProject}
            onBack={() => setView('projects')}
            onOpenPaper={handleOpenPaper}
          />
        )}
      </main>
    </div>
  );
}

export default App;
