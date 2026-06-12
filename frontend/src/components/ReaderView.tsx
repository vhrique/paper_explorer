import { useEffect, useState } from 'react';
import { api, type Paper, type Passage, type Project } from '../api';
import { PDFPanel } from './PDFPanel';
import { ContextPanel } from './ContextPanel';
import { ArrowLeft, PanelRight } from 'lucide-react';

interface Props {
  paper: Paper;
  project: Project;
  onBack: () => void;
}

export function ReaderView({ paper, project, onBack }: Props) {
  const [passages, setPassages] = useState<Passage[]>([]);
  const [selectedPassage, setSelectedPassage] = useState<Passage | null>(null);
  const [jumpToPage, setJumpToPage] = useState<number | undefined>();
  const [contextOpen, setContextOpen] = useState(true);

  useEffect(() => {
    api.listPassages(paper.id).then(setPassages);
  }, [paper.id]);

  const handlePassageCreated = (passage: Passage) => {
    setPassages(prev => [...prev, passage]);
    setSelectedPassage(passage);
  };

  const handlePassageClick = (passage: Passage) => {
    setSelectedPassage(passage);
    setJumpToPage(passage.page);
    setTimeout(() => setJumpToPage(undefined), 100);
  };

  const handlePassageDeleted = (id: number) => {
    setPassages(prev => prev.filter(p => p.id !== id));
    if (selectedPassage?.id === id) setSelectedPassage(null);
  };

  const handlePassageUpdated = (updated: Passage) => {
    setPassages(prev => prev.map(p => p.id === updated.id ? updated : p));
    setSelectedPassage(updated);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-gray-500" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-400 truncate">{project.name}</p>
          <p className="text-sm font-semibold text-gray-800 truncate">{paper.title}</p>
        </div>
        <button
          onClick={() => setContextOpen(o => !o)}
          className={`p-1.5 rounded-lg transition-colors ${contextOpen ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-400'}`}
        >
          <PanelRight size={18} />
        </button>
      </header>

      {/* Main */}
      <div className="flex flex-1 min-h-0">
        {/* PDF */}
        <div className={`flex-1 min-w-0 transition-all duration-200 ${contextOpen ? 'lg:w-[60%]' : 'w-full'}`}>
          <PDFPanel
            paperId={paper.id}
            passages={passages}
            selectedPassage={selectedPassage}
            onPassageCreated={handlePassageCreated}
            onPassageClick={handlePassageClick}
            jumpToPage={jumpToPage}
          />
        </div>

        {/* Context panel */}
        {contextOpen && (
          <div className="w-80 lg:w-96 flex-shrink-0">
            <ContextPanel
              paperId={paper.id}
              projectId={project.id}
              passages={passages}
              selectedPassage={selectedPassage}
              onSelectPassage={handlePassageClick}
              onPassageDeleted={handlePassageDeleted}
              onPassageUpdated={handlePassageUpdated}
            />
          </div>
        )}
      </div>
    </div>
  );
}
