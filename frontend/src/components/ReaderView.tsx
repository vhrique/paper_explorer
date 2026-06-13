import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Paper, type Passage, type Project, type Rect, type SimilarPassage } from '../api';
import { PDFPanel } from './PDFPanel';
import { ContextPanel } from './ContextPanel';
import { ConnectionOverlay } from './ConnectionOverlay';
import { ArrowLeft, PanelRight, X } from 'lucide-react';

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

  // Second panel state
  const [connectedSimilar, setConnectedSimilar] = useState<SimilarPassage | null>(null);
  const [connectedSimilarList, setConnectedSimilarList] = useState<SimilarPassage[]>([]);
  const [secondPassages, setSecondPassages] = useState<Passage[]>([]);
  const [secondSelectedPassage, setSecondSelectedPassage] = useState<Passage | null>(null);
  const [secondJumpToPassage, setSecondJumpToPassage] = useState<{ page: number; rect: Rect } | undefined>();
  const [sourceRect, setSourceRect] = useState<DOMRect | null>(null);
  const [targetRects, setTargetRects] = useState<DOMRect[]>([]);
  const [offscreenTargetRects, setOffscreenTargetRects] = useState<DOMRect[]>([]);

  useEffect(() => {
    api.listPassages(paper.id).then(setPassages);
  }, [paper.id]);

  useEffect(() => {
    if (!connectedSimilar) { setSecondPassages([]); return; }
    api.listPassages(connectedSimilar.paper_id).then(setSecondPassages);
  }, [connectedSimilar?.paper_id]);

  const handlePassageCreated = (passage: Passage) => {
    setPassages(prev => [...prev, passage]);
    setSelectedPassage(passage);
  };

  const handlePassageClick = (passage: Passage) => {
    setSelectedPassage(passage);
    setJumpToPage(passage.page);
    setTimeout(() => setJumpToPage(undefined), 100);
  };

  // When selected passage changes while second PDF is open, auto-refresh connections
  useEffect(() => {
    if (!selectedPassage || !connectedSimilar) return;
    api.getSimilarPassages(selectedPassage.id).then(results => {
      const forPaper = results.filter(s => s.paper_id === connectedSimilar.paper_id);
      if (forPaper.length > 0) {
        setConnectedSimilar(forPaper[0]);
        setConnectedSimilarList(forPaper);
      } else {
        setConnectedSimilarList([]);
        setTargetRects([]);
        setOffscreenTargetRects([]);
      }
    });
  }, [selectedPassage?.id]);

  const handlePassageDeleted = (id: number) => {
    setPassages(prev => prev.filter(p => p.id !== id));
    if (selectedPassage?.id === id) setSelectedPassage(null);
  };

  const handlePassageUpdated = (updated: Passage) => {
    setPassages(prev => prev.map(p => p.id === updated.id ? updated : p));
    setSelectedPassage(updated);
  };

  const handleSimilarClick = (s: SimilarPassage, allFromPaper: SimilarPassage[]) => {
    setConnectedSimilar(s);
    setConnectedSimilarList(allFromPaper);
    setTargetRects([]);
    if (s.rects[0]) {
      setSecondJumpToPassage({ page: s.page, rect: s.rects[0] });
      setTimeout(() => setSecondJumpToPassage(undefined), 100);
    }
    if (selectedPassage) {
      setJumpToPage(selectedPassage.page);
      setTimeout(() => setJumpToPage(undefined), 100);
    }
  };

  const handleCloseSecond = () => {
    setConnectedSimilar(null);
    setConnectedSimilarList([]);
    setSecondPassages([]);
    setSecondSelectedPassage(null);
    setSecondJumpToPassage(undefined);
    setTargetRects([]);
    setOffscreenTargetRects([]);
  };

  // Stable arrays — useMemo so effect deps in PDFPanel don't see a new reference every render
  const sourceConnectedPassages = useMemo(() =>
    selectedPassage && connectedSimilar && connectedSimilarList.length > 0
      ? [{ page: selectedPassage.page, rects: selectedPassage.rects, highlight: false }]
      : [],
  [selectedPassage, connectedSimilar, connectedSimilarList]);

  const targetConnectedPassages = useMemo(() =>
    sourceRect ? connectedSimilarList.map(s => ({ page: s.page, rects: s.rects, highlight: true })) : [],
  [connectedSimilarList, sourceRect]);

  // Stable callback — new DOMRect objects from compute() would otherwise re-trigger the effect
  const handleSourceRectsChange = useCallback((rects: DOMRect[]) => {
    setSourceRect(rects[0] ?? null);
  }, []);

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
        {connectedSimilar && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-lg min-w-0 max-w-xs">
            <div className="w-2 h-2 rounded-full bg-purple-500 flex-shrink-0" />
            <p className="text-xs text-purple-700 truncate">
              {connectedSimilar.paper_title}
              {connectedSimilarList.length > 1 && (
                <span className="ml-1 text-purple-400">· {connectedSimilarList.length} matches</span>
              )}
            </p>
            <button onClick={handleCloseSecond} className="p-0.5 text-purple-400 hover:text-purple-600 flex-shrink-0">
              <X size={13} />
            </button>
          </div>
        )}
        <button
          onClick={() => setContextOpen(o => !o)}
          className={`p-1.5 rounded-lg transition-colors ${contextOpen ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-400'}`}
        >
          <PanelRight size={18} />
        </button>
      </header>

      {/* Main */}
      <div className="flex flex-1 min-h-0">
        {/* First PDF */}
        <div className={`flex-1 min-w-0 ${connectedSimilar ? 'border-r border-gray-300' : ''}`}>
          <PDFPanel
            paperId={paper.id}
            projectId={project.id}
            passages={passages}
            selectedPassage={selectedPassage}
            onPassageCreated={handlePassageCreated}
            onPassageClick={handlePassageClick}
            onPassageDeleted={handlePassageDeleted}
            onPassageUpdated={handlePassageUpdated}
            jumpToPage={jumpToPage}
            connectedPassages={sourceConnectedPassages}
            onConnectedRectsChange={handleSourceRectsChange}
          />
        </div>

        {/* Second PDF */}
        {connectedSimilar && (
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-3 py-1.5 bg-purple-50 border-b border-purple-200 flex-shrink-0">
              <p className="text-xs text-purple-700 font-medium truncate">{connectedSimilar.paper_title}</p>
              <p className="text-xs text-purple-400">
                {connectedSimilarList.length} similar passage{connectedSimilarList.length !== 1 ? 's' : ''} · top {Math.round(connectedSimilar.similarity * 100)}%
              </p>
            </div>
            <div className="flex-1 min-h-0">
              <PDFPanel
                paperId={connectedSimilar.paper_id}
                projectId={project.id}
                passages={secondPassages}
                selectedPassage={secondSelectedPassage}
                onPassageCreated={p => setSecondPassages(prev => [...prev, p])}
                onPassageClick={setSecondSelectedPassage}
                onPassageDeleted={id => setSecondPassages(prev => prev.filter(p => p.id !== id))}
                onPassageUpdated={p => setSecondPassages(prev => prev.map(x => x.id === p.id ? p : x))}
                jumpToPassage={secondJumpToPassage}
                connectedPassages={targetConnectedPassages}
                onConnectedRectsChange={setTargetRects}
                onOffscreenRectsChange={setOffscreenTargetRects}
              />
            </div>
          </div>
        )}

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
              onSimilarClick={handleSimilarClick}
            />
          </div>
        )}
      </div>

      {/* K connection lines overlay */}
      {connectedSimilar && <ConnectionOverlay sourceRect={sourceRect} targetRects={targetRects} offscreenRects={offscreenTargetRects} />}
    </div>
  );
}
