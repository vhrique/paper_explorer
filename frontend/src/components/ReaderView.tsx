import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Paper, type Passage, type PassageLink, type Project, type Rect, type SimilarPassage } from '../api';
import { PDFPanel } from './PDFPanel';
import { ContextPanel } from './ContextPanel';
import { ConnectionOverlay } from './ConnectionOverlay';
import { ArrowLeft, PanelRight, X, BookOpen } from 'lucide-react';

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
  const [targetRects, setTargetRects] = useState<{ passageId: number; rect: DOMRect }[]>([]);
  const [offscreenTargetRects, setOffscreenTargetRects] = useState<DOMRect[]>([]);

  // Linking state
  const [linkingPassage, setLinkingPassage] = useState<{ passage: Passage; panel: 'first' | 'second' } | null>(null);
  const [linkingRect, setLinkingRect] = useState<DOMRect | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [passageLinks, setPassageLinks] = useState<PassageLink[]>([]);
  const [firstLinkedRects, setFirstLinkedRects] = useState<{ passageId: number; rect: DOMRect }[]>([]);
  const [secondLinkedRects, setSecondLinkedRects] = useState<{ passageId: number; rect: DOMRect }[]>([]);
  const [linksVersion, setLinksVersion] = useState(0);

  // Toggles and Hovers
  const [showSimilarityLines, setShowSimilarityLines] = useState(true);
  const [showManualLinks, setShowManualLinks] = useState(true);
  const [hoveredPassageId, setHoveredPassageId] = useState<number | null>(null);
  const [similaritySelector, setSimilaritySelector] = useState<{
    passage: Passage;
    papers: {
      paperId: number;
      title: string;
      maxSimilarity: number;
      matches: SimilarPassage[];
    }[];
  } | null>(null);

  const [allPapersInProject, setAllPapersInProject] = useState<Paper[]>([]);
  const [paperSelectorOpen, setPaperSelectorOpen] = useState(false);

  useEffect(() => {
    api.listPassages(paper.id).then(setPassages);
  }, [paper.id]);

  useEffect(() => {
    if (!connectedSimilar) { setSecondPassages([]); return; }
    api.listPassages(connectedSimilar.paper_id).then(setSecondPassages);
  }, [connectedSimilar]);

  // Load passage links when both panels are open
  useEffect(() => {
    if (!connectedSimilar || passages.length === 0) { setPassageLinks([]); return; }
    Promise.all(passages.map(p => api.getPassageLinks(p.id)))
      .then(results => setPassageLinks(results.flat()));
  }, [connectedSimilar, passages]);

  // Mouse tracking + Escape key for linking mode
  useEffect(() => {
    if (!linkingPassage) { setMousePos(null); return; }
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLinkingPassage(null); setLinkingRect(null); }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('keydown', onKey); };
  }, [linkingPassage]);

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
    setPassageLinks([]);
    setLinkingPassage(null);
    setLinkingRect(null);
  };

  // Linking handlers
  const handleLinkStart = useCallback((passage: Passage, rect: DOMRect | null, panel: 'first' | 'second') => {
    setLinkingPassage({ passage, panel });
    setLinkingRect(rect);
  }, []);

  const handleLinkTarget = useCallback(async (targetPassage: Passage) => {
    if (!linkingPassage) return;
    const link = await api.createPassageLink(linkingPassage.passage.id, targetPassage.id);
    setPassageLinks(prev => [...prev, link]);
    setLinksVersion(v => v + 1);
    setLinkingPassage(null);
    setLinkingRect(null);
  }, [linkingPassage]);

  const handleOpenLinkedPaper = (remotePaperId: number, remotePaperTitle: string, remotePage: number, remoteRects: Rect[]) => {
    const synthetic: SimilarPassage = {
      passage_id: 0,
      paper_id: remotePaperId,
      paper_title: remotePaperTitle,
      page: remotePage,
      text: '',
      similarity: 1,
      rects: remoteRects,
      tags: [],
      source: 'passage',
    };
    handleSimilarClick(synthetic, []);
  };

  const handleLinkDeletedFromPanel = (linkId: number) => {
    setPassageLinks(prev => prev.filter(l => l.id !== linkId));
    setLinksVersion(v => v + 1);
  };

  const handleUnlink = useCallback(async (passageId: number) => {
    const secondIds = new Set(secondPassages.map(p => p.id));
    const firstIds = new Set(passages.map(p => p.id));
    const link = passageLinks.find(l =>
      (l.passage_id_1 === passageId && (secondIds.has(l.passage_id_2) || firstIds.has(l.passage_id_2))) ||
      (l.passage_id_2 === passageId && (secondIds.has(l.passage_id_1) || firstIds.has(l.passage_id_1)))
    );
    if (!link) return;
    await api.deletePassageLink(link.passage_id_1, link.passage_id_2);
    setPassageLinks(prev => prev.filter(l => l.id !== link.id));
  }, [passageLinks, passages, secondPassages]);

  // Derive linked passages for each panel
  const secondPassageIds = useMemo(() => new Set(secondPassages.map(p => p.id)), [secondPassages]);
  const firstPassageIds = useMemo(() => new Set(passages.map(p => p.id)), [passages]);

  const linkedInFirstPanel = useMemo(() =>
    passages
      .filter(p => passageLinks.some(l =>
        (l.passage_id_1 === p.id && secondPassageIds.has(l.passage_id_2)) ||
        (l.passage_id_2 === p.id && secondPassageIds.has(l.passage_id_1))
      ))
      .map(p => ({ page: p.page, rects: p.rects, passageId: p.id })),
  [passages, passageLinks, secondPassageIds]);

  const linkedInSecondPanel = useMemo(() =>
    secondPassages
      .filter(p => passageLinks.some(l =>
        (l.passage_id_1 === p.id && firstPassageIds.has(l.passage_id_2)) ||
        (l.passage_id_2 === p.id && firstPassageIds.has(l.passage_id_1))
      ))
      .map(p => ({ page: p.page, rects: p.rects, passageId: p.id })),
  [secondPassages, passageLinks, firstPassageIds]);

  // Pair linked rects from both panels into source→target pairs for the overlay
  const linkRects = useMemo(() => {
    const firstMap = new Map(firstLinkedRects.map(r => [r.passageId, r.rect]));
    const secondMap = new Map(secondLinkedRects.map(r => [r.passageId, r.rect]));
    const firstIds = new Set(passages.map(p => p.id));
    const result: { source: DOMRect; target: DOMRect; sourceId: number; targetId: number }[] = [];
    for (const link of passageLinks) {
      const sourceId = firstIds.has(link.passage_id_1) ? link.passage_id_1 : link.passage_id_2;
      const targetId = sourceId === link.passage_id_1 ? link.passage_id_2 : link.passage_id_1;
      const src = firstMap.get(sourceId);
      const tgt = secondMap.get(targetId);
      if (src && tgt) {
        result.push({ source: src, target: tgt, sourceId, targetId });
      }
    }
    return result;
  }, [passageLinks, firstLinkedRects, secondLinkedRects, passages]);

  const handleFirstLinkedRectsChange = useCallback((rects: { passageId: number; rect: DOMRect }[]) => {
    setFirstLinkedRects(rects);
  }, []);

  const handleSecondLinkedRectsChange = useCallback((rects: { passageId: number; rect: DOMRect }[]) => {
    setSecondLinkedRects(rects);
  }, []);

  // Stable arrays for similarity connection lines
  const sourceConnectedPassages = useMemo(() =>
    selectedPassage && connectedSimilar
      ? [{ page: selectedPassage.page, rects: selectedPassage.rects, highlight: false, passageId: selectedPassage.id }]
      : [],
  [selectedPassage, connectedSimilar]);

  const targetConnectedPassages = useMemo(() =>
    sourceRect && selectedPassage
      ? connectedSimilarList.map(s => ({ page: s.page, rects: s.rects, highlight: true, passageId: s.passage_id }))
      : [],
  [connectedSimilarList, sourceRect, selectedPassage]);

  const handleSourceRectsChange = useCallback((rects: { passageId: number; rect: DOMRect }[]) => {
    setSourceRect(rects[0]?.rect ?? null);
  }, []);

  const secondPanelOpen = !!connectedSimilar;

  const handlePassageHover = useCallback((id: number | null) => {
    setHoveredPassageId(id);
  }, []);

  const handleFindSimilar = useCallback(async (passage: Passage) => {
    setSelectedPassage(passage);
    const results = await api.getSimilarPassages(passage.id);
    
    // Group by paper
    const paperGroups: { [key: number]: SimilarPassage[] } = {};
    for (const s of results) {
      (paperGroups[s.paper_id] ??= []).push(s);
    }

    const papersList = Object.keys(paperGroups).map(key => {
      const id = parseInt(key);
      const matches = paperGroups[id];
      const maxSim = Math.max(...matches.map(m => m.similarity));
      return {
        paperId: id,
        title: matches[0].paper_title,
        maxSimilarity: maxSim,
        matches: matches
      };
    }).sort((a, b) => b.maxSimilarity - a.maxSimilarity);

    if (papersList.length === 0) {
      alert("No similar passages found in other papers of this project.");
      return;
    }

    setSimilaritySelector({ passage, papers: papersList });
  }, []);

  const handleSelectSimilarityPaper = (paperId: number, title: string, matches: SimilarPassage[]) => {
    const topMatch = matches[0];
    setConnectedSimilar(topMatch);
    setConnectedSimilarList(matches);
    setSimilaritySelector(null);
    if (topMatch.rects[0]) {
      setSecondJumpToPassage({ page: topMatch.page, rect: topMatch.rects[0] });
      setTimeout(() => setSecondJumpToPassage(undefined), 100);
    }
  };

  const handleOpenPaperSelector = async () => {
    const list = await api.listPapers(project.id);
    const otherPapers = list.filter(p => p.id !== paper.id);
    setAllPapersInProject(otherPapers);
    setPaperSelectorOpen(true);
  };

  const handleSelectComparePaper = (targetPaper: Paper) => {
    const synthetic: SimilarPassage = {
      passage_id: 0,
      paper_id: targetPaper.id,
      paper_title: targetPaper.title,
      page: 0,
      text: '',
      similarity: 1,
      rects: [],
      tags: [],
      source: 'passage',
    };
    setConnectedSimilar(synthetic);
    setConnectedSimilarList([]);
    setTargetRects([]);
    setPaperSelectorOpen(false);

    if (selectedPassage) {
      api.getSimilarPassages(selectedPassage.id).then(results => {
        const forPaper = results.filter(s => s.paper_id === targetPaper.id);
        setConnectedSimilarList(forPaper);
      });
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <header className="relative z-20 flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-gray-500" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-400 truncate">{project.name}</p>
          <p className="text-sm font-semibold text-gray-800 truncate">{paper.title}</p>
        </div>
        {linkingPassage && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-50 border border-teal-200 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse flex-shrink-0" />
            <p className="text-xs text-teal-700">Click a passage in the other panel to link · Esc to cancel</p>
            <button onClick={() => { setLinkingPassage(null); setLinkingRect(null); }} className="p-0.5 text-teal-400 hover:text-teal-600">
              <X size={13} />
            </button>
          </div>
        )}
        {connectedSimilar && !linkingPassage && (
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
        {/* Toggle controls */}
        <div className="flex items-center gap-4 border-r border-gray-200 pr-3 mr-1">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showSimilarityLines}
              onChange={e => setShowSimilarityLines(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-purple-600 focus:ring-purple-400 border-gray-300"
            />
            <span className="text-xs font-medium text-gray-600">Similarities</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showManualLinks}
              onChange={e => setShowManualLinks(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-teal-600 focus:ring-teal-400 border-gray-300"
            />
            <span className="text-xs font-medium text-gray-600">Manual Links</span>
          </label>
        </div>
        <button
          onClick={handleOpenPaperSelector}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-blue-600 transition-colors mr-2 text-gray-600"
          title="Compare with another paper"
        >
          <BookOpen size={14} />
          <span>Compare Paper</span>
        </button>
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
            connectedPassages={showSimilarityLines ? sourceConnectedPassages : []}
            onConnectedRectsChange={handleSourceRectsChange}
            onLinkStart={secondPanelOpen ? (p, r) => handleLinkStart(p, r, 'first') : undefined}
            linkingTarget={linkingPassage?.panel === 'second'}
            onLinkTarget={linkingPassage?.panel === 'second' ? handleLinkTarget : undefined}
            linkedPassages={secondPanelOpen ? linkedInFirstPanel : undefined}
            onLinkedRectsChange={secondPanelOpen ? handleFirstLinkedRectsChange : undefined}
            onUnlink={secondPanelOpen ? handleUnlink : undefined}
            onFindSimilar={handleFindSimilar}
            onPassageHover={handlePassageHover}
          />
        </div>

        {/* Second PDF */}
        {connectedSimilar && (
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="relative z-20 px-3 py-1.5 bg-purple-50 border-b border-purple-200 flex-shrink-0">
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
                connectedPassages={showSimilarityLines ? targetConnectedPassages : []}
                onConnectedRectsChange={setTargetRects}
                onOffscreenRectsChange={setOffscreenTargetRects}
                onLinkStart={(p, r) => handleLinkStart(p, r, 'second')}
                linkingTarget={linkingPassage?.panel === 'first'}
                onLinkTarget={linkingPassage?.panel === 'first' ? handleLinkTarget : undefined}
                linkedPassages={linkedInSecondPanel}
                onLinkedRectsChange={handleSecondLinkedRectsChange}
                onUnlink={handleUnlink}
                onPassageHover={handlePassageHover}
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
              onOpenLinkedPaper={handleOpenLinkedPaper}
              onLinkDeleted={handleLinkDeletedFromPanel}
              linksVersion={linksVersion}
            />
          </div>
        )}
      </div>

      {/* Overlay: similarity lines + link lines + rubber-band */}
      <ConnectionOverlay
        sourceRect={sourceRect}
        targetRects={showSimilarityLines ? targetRects : []}
        linkRects={showManualLinks ? linkRects : []}
        linkingSource={linkingRect}
        linkingMouse={mousePos}
        hoveredPassageId={hoveredPassageId}
        selectedPassageId={selectedPassage?.id}
      />

      {/* Modal for selecting paper to open for similarities */}
      {similaritySelector && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">Compare Similarities</h3>
              <button
                onClick={() => setSimilaritySelector(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X size={15} />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Select a paper in the project to compare against:
            </p>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {similaritySelector.papers.map(p => (
                <button
                  key={p.paperId}
                  onClick={() => handleSelectSimilarityPaper(p.paperId, p.title, p.matches)}
                  className="w-full text-left p-3 border border-gray-100 hover:border-purple-300 hover:bg-purple-50 transition-colors flex items-center justify-between rounded-xl"
                >
                  <div className="min-w-0 pr-3">
                    <p className="text-xs font-semibold text-gray-700 truncate">{p.title}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{p.matches.length} matching passage{p.matches.length !== 1 ? 's' : ''}</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-600 border border-purple-100 rounded-full font-medium flex-shrink-0">
                    {Math.round(p.maxSimilarity * 100)}% match
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Modal for selecting any paper to open in compare panel */}
      {paperSelectorOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">Compare with Paper</h3>
              <button
                onClick={() => setPaperSelectorOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X size={15} />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Select another paper from the project <strong>{project.name}</strong>:
            </p>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {allPapersInProject.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No other papers in this project.</p>
              ) : (
                allPapersInProject.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectComparePaper(p)}
                    className="w-full text-left p-3 border border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition-colors rounded-xl truncate text-xs font-semibold text-gray-700 block"
                  >
                    {p.title}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
