import { useState } from 'react';
import { LibraryView } from './components/LibraryView';
import { ReaderView } from './components/ReaderView';
import type { Paper, Project } from './api';

function App() {
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  if (selectedPaper && selectedProject) {
    return (
      <ReaderView
        paper={selectedPaper}
        project={selectedProject}
        onBack={() => { setSelectedPaper(null); setSelectedProject(null); }}
      />
    );
  }

  return (
    <LibraryView
      onOpenPaper={(paper, project) => {
        setSelectedPaper(paper);
        setSelectedProject(project);
      }}
    />
  );
}

export default App;
