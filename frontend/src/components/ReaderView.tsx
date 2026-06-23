import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Note, type Paper, type Passage, type PassageLink, type Project, type Rect, type SimilarPassage, type PaperMetadataResult } from '../api';
import * as ws from '../storage/workspace';
import { computeSimilarAll, preloadProjectEmbeddings } from '../utils/similarity';
import { triggerModelTraining, scheduleModelTraining } from '../services/similarityModel';
import { PDFPanel } from './PDFPanel';
import { ContextPanel } from './ContextPanel';
import { ConnectionOverlay } from './ConnectionOverlay';
import { ArrowLeft, PanelRight, Pencil, RefreshCw, X, Cpu, Settings, ChevronDown, Columns2 } from 'lucide-react';

interface Props {
  paper: Paper;
  project: Project;
  onBack: () => void;
  onOpenSettings?: () => void;
}

function PaperDropdown({ paper, papers, onSelect }: {
  paper: Paper | null;
  papers: Paper[];
  onSelect: (p: Paper) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex-1 min-w-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-blue-600 min-w-0 max-w-full"
      >
        <span className="truncate">{paper?.title ?? 'Select a paper…'}</span>
        <ChevronDown size={11} className="flex-shrink-0 text-gray-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 z-50 mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl max-h-72 overflow-y-auto">
            {papers.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No papers in this project.</p>
            ) : papers.map(p => (
              <button
                key={p.id}
                onClick={() => { onSelect(p); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 hover:text-blue-700 truncate ${p.id === paper?.id ? 'font-semibold text-blue-600 bg-blue-50' : 'text-gray-700'}`}
              >
                {p.title}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ReaderView({ paper, project, onBack, onOpenSettings }: Props) {
  // Left panel
  const [leftPaper, setLeftPaper] = useState<Paper>(paper);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [selectedPassage, setSelectedPassage] = useState<Passage | null>(null);
  const [jumpToPage, setJumpToPage] = useState<number | undefined>();
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [notesForPaper, setNotesForPaper] = useState<Note[]>([]);
  const [leftPaperInfo, setLeftPaperInfo] = useState<Paper>(paper);

  // Right panel
  const [rightPaper, setRightPaper] = useState<Paper | null>(null);
  const [rightPassages, setRightPassages] = useState<Passage[]>([]);
  const [rightSelectedPassage, setRightSelectedPassage] = useState<Passage | null>(null);
  const [rightJumpToPassage, setRightJumpToPassage] = useState<{ page: number; rect: Rect } | undefined>();
  const [rightJumpToPage, setRightJumpToPage] = useState<number | undefined>();
  const [rightPdfUrl, setRightPdfUrl] = useState<string>('');
  const [rightNotesForPaper, setRightNotesForPaper] = useState<Note[]>([]);

  // Focus
  const [focusedPanel, setFocusedPanel] = useState<'left' | 'right'>('left');

  // Similarity
  const [leftToRightSimilarity, setLeftToRightSimilarity] = useState<SimilarPassage[]>([]);
  const [rightToLeftSimilarity, setRightToLeftSimilarity] = useState<SimilarPassage[]>([]);
  const [trainingSimilarity, setTrainingSimilarity] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState<string | null>(null);

  // Overlay rects
  const [leftPanelConnectedRects, setLeftPanelConnectedRects] = useState<{ passageId: number; rect: DOMRect }[]>([]);
  const [rightPanelConnectedRects, setRightPanelConnectedRects] = useState<{ passageId: number; rect: DOMRect }[]>([]);

  // Linking
  const [linkingPassage, setLinkingPassage] = useState<{ passage: Passage; panel: 'left' | 'right' } | null>(null);
  const [linkingRect, setLinkingRect] = useState<DOMRect | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [passageLinks, setPassageLinks] = useState<PassageLink[]>([]);
  const [leftLinkedRects, setLeftLinkedRects] = useState<{ passageId: number; rect: DOMRect }[]>([]);
  const [rightLinkedRects, setRightLinkedRects] = useState<{ passageId: number; rect: DOMRect }[]>([]);
  const [linksVersion, setLinksVersion] = useState(0);

  // Toggles
  const [showSimilarityLines, setShowSimilarityLines] = useState(true);
  const [showManualLinks, setShowManualLinks] = useState(true);
  const [hoveredPassageId, setHoveredPassageId] = useState<number | null>(null);
  const [contextOpen, setContextOpen] = useState(true);

  // All project papers
  const [allProjectPapers, setAllProjectPapers] = useState<Paper[]>([]);

  // Similarity paper-selector dialog
  const [similaritySelector, setSimilaritySelector] = useState<{
    sourceSide: 'left' | 'right';
    papers: { paperId: number; title: string; maxSimilarity: number; matches: SimilarPassage[] }[];
  } | null>(null);

  // Force-tab nonce for notes
  const [forceTabNonce, setForceTabNonce] = useState(0);

  // Paper info editing (left panel)
  const [editingInfo, setEditingInfo] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDoi, setEditDoi] = useState('');
  const [editArxivId, setEditArxivId] = useState('');
  const [editAbstract, setEditAbstract] = useState('');
  const [fetchedMeta, setFetchedMeta] = useState<PaperMetadataResult | null>(null);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);

  // Load project papers on mount and immediately preload all chunk/embedding caches.
  useEffect(() => {
    ws.getProjectPapers(project.id).then(papers => {
      setAllProjectPapers(papers);
      // Warm similarity caches for every paper so auto-compute is fast when user selects a passage.
      preloadProjectEmbeddings(project.id, -1);
    });
  }, [project.id]);

  // Load left paper data when leftPaper changes
  useEffect(() => {
    setPassages([]);
    setSelectedPassage(null);
    setPdfUrl('');
    setNotesForPaper([]);
    setLeftPaperInfo(leftPaper);
    setLeftToRightSimilarity([]);
    ws.getPassages(leftPaper.id).then(setPassages);
    ws.getPdfBlobUrl(leftPaper.id).then(setPdfUrl).catch(() => {});
    ws.getNotes(leftPaper.id).then(setNotesForPaper).catch(() => {});
  }, [leftPaper.id]);

  // Load right paper data when rightPaper changes
  useEffect(() => {
    if (!rightPaper) {
      setRightPassages([]);
      setRightPdfUrl('');
      setRightNotesForPaper([]);
      setRightSelectedPassage(null);
      setLeftToRightSimilarity([]);
      setRightToLeftSimilarity([]);
      return;
    }
    setRightPassages([]);
    setRightSelectedPassage(null);
    setRightToLeftSimilarity([]);
    ws.getPassages(rightPaper.id).then(setRightPassages);
    ws.getPdfBlobUrl(rightPaper.id).then(setRightPdfUrl).catch(() => {});
    ws.getNotes(rightPaper.id).then(setRightNotesForPaper).catch(() => {});
  }, [rightPaper?.id]);

  // Load passage links when both panels are open
  useEffect(() => {
    if (!rightPaper || passages.length === 0) { setPassageLinks([]); return; }
    ws.getPassageLinks(leftPaper.id).then(setPassageLinks);
  }, [rightPaper, passages, leftPaper.id]);

  // Linking mousemove/keydown
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

  // Auto-compute left→right similarity when left passage changes and right panel is open.
  useEffect(() => {
    if (!selectedPassage || !rightPaper) { setLeftToRightSimilarity([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      ws.getPassageEmbeddings(leftPaper.id)
        .then(embs => {
          if (cancelled) return null;
          const match = embs.find(e => e.id === selectedPassage.id);
          return computeSimilarAll(match?.embedding ?? null, selectedPassage.text, project.id, leftPaper.id, 10, rightPaper.id);
        })
        .then(r => { if (!cancelled && r) setLeftToRightSimilarity(r); })
        .catch(() => {});
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedPassage?.id, rightPaper?.id]);

  // Auto-compute right→left similarity when right passage changes.
  useEffect(() => {
    if (!rightSelectedPassage || !rightPaper) { setRightToLeftSimilarity([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      ws.getPassageEmbeddings(rightPaper.id)
        .then(embs => {
          if (cancelled) return null;
          const match = embs.find(e => e.id === rightSelectedPassage.id);
          return computeSimilarAll(match?.embedding ?? null, rightSelectedPassage.text, project.id, rightPaper.id, 10, leftPaper.id);
        })
        .then(r => { if (!cancelled && r) setRightToLeftSimilarity(r); })
        .catch(() => {});
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [rightSelectedPassage?.id, rightPaper?.id]);

  // Left panel handlers
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

  // Right panel handlers
  const handleRightPassageClick = (passage: Passage) => {
    setRightSelectedPassage(passage);
    setRightJumpToPage(passage.page);
    setTimeout(() => setRightJumpToPage(undefined), 100);
  };

  // Similarity click → navigate other panel
  const handleSimilarClick = useCallback((s: SimilarPassage, allFromPaper: SimilarPassage[]) => {
    if (focusedPanel === 'left') {
      const targetPaper = allProjectPapers.find(p => p.id === s.paper_id);
      if (targetPaper && rightPaper?.id !== s.paper_id) setRightPaper(targetPaper);
      setLeftToRightSimilarity(allFromPaper);
      if (s.rects[0]) {
        setRightJumpToPassage({ page: s.page, rect: s.rects[0] });
        setTimeout(() => setRightJumpToPassage(undefined), 100);
      }
    } else {
      const targetPaper = allProjectPapers.find(p => p.id === s.paper_id);
      if (targetPaper && leftPaper.id !== s.paper_id) setLeftPaper(targetPaper);
      setRightToLeftSimilarity(allFromPaper);
      setJumpToPage(s.page);
      setTimeout(() => setJumpToPage(undefined), 100);
    }
  }, [focusedPanel, allProjectPapers, rightPaper?.id, leftPaper.id]);

  const handleOpenLinkedPaper = useCallback((remotePaperId: number, remotePaperTitle: string, remotePage: number, remoteRects: Rect[]) => {
    const synthetic: SimilarPassage = {
      passage_id: 0, paper_id: remotePaperId, paper_title: remotePaperTitle,
      page: remotePage, text: '', similarity: 1, rects: remoteRects, tags: [], source: 'passage',
    };
    handleSimilarClick(synthetic, []);
  }, [handleSimilarClick]);

  const handleCloseRight = () => {
    setRightPaper(null);
    setLinkingPassage(null);
    setLinkingRect(null);
    setFocusedPanel('left');
  };

  const openDefaultRightPaper = () => {
    const other = allProjectPapers.find(p => p.id !== leftPaper.id);
    if (other) setRightPaper(other);
  };

  // Find Similar — computes results then shows paper-picker dialog
  const handleFindSimilar = useCallback(async (passage: Passage, side: 'left' | 'right') => {
    const sourcePaperId = side === 'left' ? leftPaper.id : rightPaper?.id;
    if (!sourcePaperId) return;
    if (side === 'left') setSelectedPassage(passage);
    else setRightSelectedPassage(passage);

    const embs = await ws.getPassageEmbeddings(sourcePaperId);
    const match = embs.find(e => e.id === passage.id);
    const results = await computeSimilarAll(match?.embedding ?? null, passage.text, project.id, sourcePaperId, 20);

    const paperGroups: Record<number, SimilarPassage[]> = {};
    for (const s of results) (paperGroups[s.paper_id] ??= []).push(s);
    const papersList = Object.entries(paperGroups).map(([key, matches]) => ({
      paperId: parseInt(key),
      title: matches[0].paper_title,
      maxSimilarity: Math.max(...matches.map(m => m.similarity)),
      matches,
    })).sort((a, b) => b.maxSimilarity - a.maxSimilarity);

    if (papersList.length === 0) { alert('No similar passages found in other papers of this project.'); return; }
    setSimilaritySelector({ sourceSide: side, papers: papersList });
  }, [leftPaper.id, rightPaper?.id, project.id]);

  const handleSelectSimilarityPaper = (paperId: number, matches: SimilarPassage[]) => {
    if (!similaritySelector) return;
    const topMatch = matches[0];
    if (similaritySelector.sourceSide === 'left') {
      const target = allProjectPapers.find(p => p.id === paperId);
      if (target) setRightPaper(target);
      setLeftToRightSimilarity(matches);
      if (topMatch?.rects[0]) {
        setRightJumpToPassage({ page: topMatch.page, rect: topMatch.rects[0] });
        setTimeout(() => setRightJumpToPassage(undefined), 100);
      }
    } else {
      const target = allProjectPapers.find(p => p.id === paperId);
      if (target) setLeftPaper(target);
      setRightToLeftSimilarity(matches);
      if (topMatch) { setJumpToPage(topMatch.page); setTimeout(() => setJumpToPage(undefined), 100); }
    }
    setSimilaritySelector(null);
  };

  // Linking
  const handleLinkStart = useCallback((passage: Passage, rect: DOMRect | null, panel: 'left' | 'right') => {
    setLinkingPassage({ passage, panel });
    setLinkingRect(rect);
  }, []);

  const handleLinkTarget = useCallback(async (targetPassage: Passage) => {
    if (!linkingPassage) return;
    const link = await ws.createPassageLink(linkingPassage.passage.id, targetPassage.id);
    setPassageLinks(prev => [...prev, link]);
    setLinksVersion(v => v + 1);
    setLinkingPassage(null);
    setLinkingRect(null);
    scheduleModelTraining(project.id);
  }, [linkingPassage, project.id]);

  const handleLinkDeletedFromPanel = (linkId: number) => {
    setPassageLinks(prev => prev.filter(l => l.id !== linkId));
    setLinksVersion(v => v + 1);
  };

  const handleUnlink = useCallback(async (passageId: number) => {
    const rightIds = new Set(rightPassages.map(p => p.id));
    const leftIds = new Set(passages.map(p => p.id));
    const link = passageLinks.find(l =>
      (l.passage_id_1 === passageId && (rightIds.has(l.passage_id_2) || leftIds.has(l.passage_id_2))) ||
      (l.passage_id_2 === passageId && (rightIds.has(l.passage_id_1) || leftIds.has(l.passage_id_1)))
    );
    if (!link) return;
    await ws.deletePassageLink(link.passage_id_1, link.passage_id_2);
    setPassageLinks(prev => prev.filter(l => l.id !== link.id));
    scheduleModelTraining(project.id);
  }, [passageLinks, passages, rightPassages, project.id]);

  // Receive similarity results from ContextPanel and update overlay state
  const handleSimilarResults = useCallback((results: SimilarPassage[], sourcePaperId: number) => {
    if (sourcePaperId === leftPaper.id && rightPaper) {
      setLeftToRightSimilarity(results.filter(s => s.paper_id === rightPaper.id));
    } else if (rightPaper && sourcePaperId === rightPaper.id) {
      setRightToLeftSimilarity(results.filter(s => s.paper_id === leftPaper.id));
    }
  }, [leftPaper.id, rightPaper?.id]);

  // Notes
  const notesByPassageId = useMemo(() => {
    const map: Record<number, { id: number; content: string }[]> = {};
    for (const note of notesForPaper) {
      for (const pid of note.passage_ids) {
        (map[pid] ??= []).push({ id: note.id, content: note.content });
      }
    }
    return map;
  }, [notesForPaper]);

  const rightNotesByPassageId = useMemo(() => {
    const map: Record<number, { id: number; content: string }[]> = {};
    for (const note of rightNotesForPaper) {
      for (const pid of note.passage_ids) {
        (map[pid] ??= []).push({ id: note.id, content: note.content });
      }
    }
    return map;
  }, [rightNotesForPaper]);

  const handleNotesChanged = useCallback(() => {
    if (focusedPanel === 'left') {
      ws.getNotes(leftPaper.id).then(setNotesForPaper).catch(() => {});
    } else if (rightPaper) {
      ws.getNotes(rightPaper.id).then(setRightNotesForPaper).catch(() => {});
    }
  }, [focusedPanel, leftPaper.id, rightPaper?.id]);

  const handleNoteClick = useCallback((passage: Passage) => {
    setSelectedPassage(passage);
    setFocusedPanel('left');
    setForceTabNonce(n => n + 1);
    if (!contextOpen) setContextOpen(true);
  }, [contextOpen]);

  const handleRightNoteClick = useCallback((passage: Passage) => {
    setRightSelectedPassage(passage);
    setFocusedPanel('right');
    setForceTabNonce(n => n + 1);
    if (!contextOpen) setContextOpen(true);
  }, [contextOpen]);

  // Training
  const handleTrainSimilarity = async () => {
    setTrainingSimilarity(true);
    setTrainingStatus(null);
    try {
      const result = await triggerModelTraining(project.id);
      const messages: Record<string, string> = {
        'trained': 'Model trained.',
        'cleared': 'No links — model cleared.',
        'no-links': 'No passage links found.',
        'no-embeddings': 'No embeddings found.',
        'already-running': 'Training in progress.',
        'error': 'Training failed.',
      };
      setTrainingStatus(messages[result] ?? result);
    } finally {
      setTrainingSimilarity(false);
    }
  };

  // Linked passages sets
  const rightPassageIds = useMemo(() => new Set(rightPassages.map(p => p.id)), [rightPassages]);
  const leftPassageIds = useMemo(() => new Set(passages.map(p => p.id)), [passages]);

  const linkedInLeftPanel = useMemo(() =>
    passages
      .filter(p => passageLinks.some(l =>
        (l.passage_id_1 === p.id && rightPassageIds.has(l.passage_id_2)) ||
        (l.passage_id_2 === p.id && rightPassageIds.has(l.passage_id_1))
      ))
      .map(p => ({ page: p.page, rects: p.rects, passageId: p.id })),
  [passages, passageLinks, rightPassageIds]);

  const linkedInRightPanel = useMemo(() =>
    rightPassages
      .filter(p => passageLinks.some(l =>
        (l.passage_id_1 === p.id && leftPassageIds.has(l.passage_id_2)) ||
        (l.passage_id_2 === p.id && leftPassageIds.has(l.passage_id_1))
      ))
      .map(p => ({ page: p.page, rects: p.rects, passageId: p.id })),
  [rightPassages, passageLinks, leftPassageIds]);

  const linkRects = useMemo(() => {
    const leftMap = new Map(leftLinkedRects.map(r => [r.passageId, r.rect]));
    const rightMap = new Map(rightLinkedRects.map(r => [r.passageId, r.rect]));
    const leftIds = new Set(passages.map(p => p.id));
    const result: { source: DOMRect; target: DOMRect; sourceId: number; targetId: number }[] = [];
    for (const link of passageLinks) {
      const sourceId = leftIds.has(link.passage_id_1) ? link.passage_id_1 : link.passage_id_2;
      const targetId = sourceId === link.passage_id_1 ? link.passage_id_2 : link.passage_id_1;
      const src = leftMap.get(sourceId);
      const tgt = rightMap.get(targetId);
      if (src && tgt) result.push({ source: src, target: tgt, sourceId, targetId });
    }
    return result;
  }, [passageLinks, leftLinkedRects, rightLinkedRects, passages]);

  // Connected passages for overlay (per panel, based on focus)
  const leftConnectedPassages = useMemo(() => {
    if (!showSimilarityLines) return [];
    if (focusedPanel === 'left') {
      return selectedPassage && rightPaper
        ? [{ page: selectedPassage.page, rects: selectedPassage.rects, highlight: false, passageId: selectedPassage.id }]
        : [];
    }
    return rightToLeftSimilarity.map(s => ({ page: s.page, rects: s.rects, highlight: true, passageId: s.passage_id }));
  }, [focusedPanel, selectedPassage, rightPaper, rightToLeftSimilarity, showSimilarityLines]);

  const rightConnectedPassages = useMemo(() => {
    if (!showSimilarityLines) return [];
    if (focusedPanel === 'right') {
      return rightSelectedPassage && rightPaper
        ? [{ page: rightSelectedPassage.page, rects: rightSelectedPassage.rects, highlight: false, passageId: rightSelectedPassage.id }]
        : [];
    }
    return leftToRightSimilarity.map(s => ({ page: s.page, rects: s.rects, highlight: true, passageId: s.passage_id }));
  }, [focusedPanel, rightSelectedPassage, rightPaper, leftToRightSimilarity, showSimilarityLines]);

  // Always pass left-panel rects as left side and right-panel rects as right side.
  // ConnectionOverlay always draws left.right → right.left regardless of which side is "source".

  // ContextPanel receives data from focused panel
  const ctxPaperId = focusedPanel === 'left' ? leftPaper.id : (rightPaper?.id ?? leftPaper.id);
  const ctxPaperTitle = focusedPanel === 'left' ? leftPaperInfo.title : (rightPaper?.title ?? leftPaperInfo.title);
  const ctxPassages = focusedPanel === 'left' ? passages : rightPassages;
  const ctxSelected = focusedPanel === 'left' ? selectedPassage : rightSelectedPassage;
  const ctxOnSelect = focusedPanel === 'left' ? handlePassageClick : handleRightPassageClick;
  const ctxOnDeleted = focusedPanel === 'left'
    ? handlePassageDeleted
    : (id: number) => { setRightPassages(p => p.filter(x => x.id !== id)); if (rightSelectedPassage?.id === id) setRightSelectedPassage(null); };
  const ctxOnUpdated = focusedPanel === 'left'
    ? handlePassageUpdated
    : (p: Passage) => { setRightPassages(prev => prev.map(x => x.id === p.id ? p : x)); setRightSelectedPassage(p); };

  // Stable callbacks for rects
  const handleLeftLinkedRectsChange = useCallback((rects: { passageId: number; rect: DOMRect }[]) => setLeftLinkedRects(rects), []);
  const handleRightLinkedRectsChange = useCallback((rects: { passageId: number; rect: DOMRect }[]) => setRightLinkedRects(rects), []);
  const handlePassageHover = useCallback((id: number | null) => setHoveredPassageId(id), []);

  const handleSwitchLeftPaper = (p: Paper) => {
    setLeftPaper(p);
    setLeftLinkedRects([]);
    setPassageLinks([]);
  };

  const handleSwitchRightPaper = (p: Paper) => {
    setRightPaper(p);
    setRightLinkedRects([]);
    setPassageLinks([]);
  };

  // Paper info editing
  const openEditInfo = () => {
    setEditTitle(leftPaperInfo.title);
    setEditDoi(leftPaperInfo.doi || '');
    setEditArxivId(leftPaperInfo.arxiv_id || '');
    setEditAbstract(leftPaperInfo.abstract || '');
    setFetchedMeta(null);
    setEditingInfo(true);
  };

  const handleFetchMeta = async () => {
    setFetchingMeta(true);
    try {
      const meta = await api.fetchMetadata(editDoi || undefined, editArxivId || undefined, editTitle || undefined);
      setFetchedMeta(meta);
      if (meta.title) setEditTitle(meta.title);
      if (meta.doi) setEditDoi(meta.doi);
      if (meta.abstract) setEditAbstract(meta.abstract);
    } catch {
      alert('No metadata found. Try correcting the DOI or arXiv ID.');
    } finally {
      setFetchingMeta(false);
    }
  };

  const handleSaveInfo = async () => {
    setSavingInfo(true);
    try {
      const updated = await ws.updatePaperMetadata(leftPaper.id, {
        title: editTitle || leftPaperInfo.title,
        doi: editDoi || undefined,
        arxiv_id: editArxivId || undefined,
        abstract: editAbstract || undefined,
      });
      setLeftPaperInfo(updated);
      setEditingInfo(false);
    } finally {
      setSavingInfo(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <header className="relative z-20 flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-gray-500" />
        </button>
        <p className="text-sm font-semibold text-gray-700 flex-shrink-0">{project.name}</p>
        {linkingPassage && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-50 border border-teal-200 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse flex-shrink-0" />
            <p className="text-xs text-teal-700">Click a passage in the other panel to link · Esc to cancel</p>
            <button onClick={() => { setLinkingPassage(null); setLinkingRect(null); }} className="p-0.5 text-teal-400 hover:text-teal-600">
              <X size={13} />
            </button>
          </div>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-4 border-r border-gray-200 pr-3 mr-1">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={showSimilarityLines} onChange={e => setShowSimilarityLines(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-purple-600 focus:ring-purple-400 border-gray-300" />
            <span className="text-xs font-medium text-gray-600">Similarities</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={showManualLinks} onChange={e => setShowManualLinks(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-teal-600 focus:ring-teal-400 border-gray-300" />
            <span className="text-xs font-medium text-gray-600">Manual Links</span>
          </label>
        </div>
        <div className="flex items-center gap-2 mr-2">
          <button onClick={handleTrainSimilarity} disabled={trainingSimilarity}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border rounded-lg transition-colors border-teal-200 text-teal-600 bg-teal-50 hover:bg-teal-100 hover:text-teal-700 disabled:opacity-50"
            title="Train similarity model on manual passage links">
            <Cpu size={14} className={trainingSimilarity ? 'animate-spin' : ''} />
            <span>{trainingSimilarity ? 'Training…' : 'Train Model'}</span>
          </button>
          {trainingStatus && (
            <span className="text-xs text-gray-500 max-w-xs truncate" title={trainingStatus}>{trainingStatus}</span>
          )}
        </div>
        <button
          onClick={() => rightPaper ? handleCloseRight() : openDefaultRightPaper()}
          className={`p-1.5 rounded-lg transition-colors ${rightPaper ? 'bg-purple-50 text-purple-600' : 'hover:bg-gray-100 text-gray-400'}`}
          title={rightPaper ? 'Close second panel' : 'Open second paper'}
        >
          <Columns2 size={16} />
        </button>
        <button onClick={() => setContextOpen(o => !o)}
          className={`p-1.5 rounded-lg transition-colors ${contextOpen ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-400'}`}>
          <PanelRight size={18} />
        </button>
        <button onClick={onOpenSettings} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="Settings">
          <Settings size={16} className="text-gray-400" />
        </button>
      </header>

      {/* Main panels */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel */}
        <div
          className={`flex-1 min-w-0 flex flex-col ${rightPaper ? 'border-r border-gray-300' : ''}`}
          onMouseDownCapture={() => setFocusedPanel('left')}
        >
          <div className={`flex items-center gap-2 px-3 py-1.5 bg-white border-b flex-shrink-0 ${focusedPanel === 'left' ? 'border-b-2 border-blue-300' : 'border-gray-200'}`}>
            <PaperDropdown
              paper={leftPaperInfo}
              papers={allProjectPapers.filter(p => p.id !== rightPaper?.id)}
              onSelect={handleSwitchLeftPaper}
            />
            <button onClick={openEditInfo} className="p-1 text-gray-300 hover:text-blue-500 rounded transition-colors flex-shrink-0" title="Edit paper info">
              <Pencil size={12} />
            </button>
          </div>
          {pdfUrl && (
            <PDFPanel
              paperId={leftPaper.id}
              pdfUrl={pdfUrl}
              projectId={project.id}
              passages={passages}
              selectedPassage={selectedPassage}
              onPassageCreated={handlePassageCreated}
              onPassageClick={handlePassageClick}
              onPassageDeleted={handlePassageDeleted}
              onPassageUpdated={handlePassageUpdated}
              jumpToPage={jumpToPage}
              connectedPassages={leftConnectedPassages}
              onConnectedRectsChange={setLeftPanelConnectedRects}
              onLinkStart={rightPaper ? (p, r) => handleLinkStart(p, r, 'left') : undefined}
              linkingTarget={linkingPassage?.panel === 'right'}
              onLinkTarget={linkingPassage?.panel === 'right' ? handleLinkTarget : undefined}
              linkedPassages={rightPaper ? linkedInLeftPanel : undefined}
              onLinkedRectsChange={rightPaper ? handleLeftLinkedRectsChange : undefined}
              onUnlink={rightPaper ? handleUnlink : undefined}
              onFindSimilar={(passage) => handleFindSimilar(passage, 'left')}
              onPassageHover={handlePassageHover}
              notesByPassageId={notesByPassageId}
              onNoteClick={handleNoteClick}
            />
          )}
        </div>

        {/* Right panel */}
        {rightPaper && (
          <div
            className="flex-1 min-w-0 flex flex-col"
            onMouseDownCapture={() => setFocusedPanel('right')}
          >
            <div className={`flex items-center gap-2 px-3 py-1.5 bg-white border-b flex-shrink-0 ${focusedPanel === 'right' ? 'border-b-2 border-blue-300' : 'border-gray-200'}`}>
              <PaperDropdown
                paper={rightPaper}
                papers={allProjectPapers.filter(p => p.id !== leftPaper.id)}
                onSelect={handleSwitchRightPaper}
              />
              <button onClick={handleCloseRight} className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors flex-shrink-0" title="Close panel">
                <X size={14} />
              </button>
            </div>
            {rightPdfUrl && (
              <PDFPanel
                paperId={rightPaper.id}
                pdfUrl={rightPdfUrl}
                projectId={project.id}
                passages={rightPassages}
                selectedPassage={rightSelectedPassage}
                onPassageCreated={p => { setRightPassages(prev => [...prev, p]); setRightSelectedPassage(p); }}
                onPassageClick={handleRightPassageClick}
                onPassageDeleted={id => { setRightPassages(p => p.filter(x => x.id !== id)); if (rightSelectedPassage?.id === id) setRightSelectedPassage(null); }}
                onPassageUpdated={p => { setRightPassages(prev => prev.map(x => x.id === p.id ? p : x)); setRightSelectedPassage(p); }}
                jumpToPassage={rightJumpToPassage}
                jumpToPage={rightJumpToPage}
                connectedPassages={rightConnectedPassages}
                onConnectedRectsChange={setRightPanelConnectedRects}
                onLinkStart={(p, r) => handleLinkStart(p, r, 'right')}
                linkingTarget={linkingPassage?.panel === 'left'}
                onLinkTarget={linkingPassage?.panel === 'left' ? handleLinkTarget : undefined}
                linkedPassages={linkedInRightPanel}
                onLinkedRectsChange={handleRightLinkedRectsChange}
                onUnlink={handleUnlink}
                onFindSimilar={(passage) => handleFindSimilar(passage, 'right')}
                onPassageHover={handlePassageHover}
                notesByPassageId={rightNotesByPassageId}
                onNoteClick={handleRightNoteClick}
              />
            )}
          </div>
        )}

        {contextOpen && (
          <div className="w-80 lg:w-96 flex-shrink-0">
            <ContextPanel
              paperId={ctxPaperId}
              paperTitle={ctxPaperTitle}
              projectId={project.id}
              passages={ctxPassages}
              selectedPassage={ctxSelected}
              onSelectPassage={ctxOnSelect}
              onPassageDeleted={ctxOnDeleted}
              onPassageUpdated={ctxOnUpdated}
              onSimilarClick={handleSimilarClick}
              onOpenLinkedPaper={handleOpenLinkedPaper}
              onLinkDeleted={handleLinkDeletedFromPanel}
              linksVersion={linksVersion}
              forceTab={forceTabNonce > 0 ? `notes:${forceTabNonce}` : undefined}
              onNotesChanged={handleNotesChanged}
              onSimilarResults={handleSimilarResults}
            />
          </div>
        )}
      </div>

      <ConnectionOverlay
        leftSideRects={showSimilarityLines ? leftPanelConnectedRects : []}
        rightSideRects={showSimilarityLines ? rightPanelConnectedRects : []}
        linkRects={showManualLinks ? linkRects : []}
        linkingSource={linkingRect}
        linkingMouse={mousePos}
        hoveredPassageId={hoveredPassageId}
        selectedPassageId={ctxSelected?.id}
      />

      {/* Edit paper info modal */}
      {editingInfo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingInfo(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Paper Info</h3>
              <button onClick={() => setEditingInfo(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">DOI</label>
                <div className="flex gap-2">
                  <input value={editDoi} onChange={e => setEditDoi(e.target.value)} placeholder="10.xxxx/xxxxx"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <button onClick={handleFetchMeta} disabled={fetchingMeta}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 bg-gray-50 rounded-lg hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors disabled:opacity-50">
                    <RefreshCw size={13} className={fetchingMeta ? 'animate-spin' : ''} /> Fetch
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">arXiv ID</label>
                <div className="flex gap-2">
                  <input value={editArxivId} onChange={e => setEditArxivId(e.target.value)} placeholder="2301.07041"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  {!editDoi && (
                    <button onClick={handleFetchMeta} disabled={fetchingMeta}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 bg-gray-50 rounded-lg hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors disabled:opacity-50">
                      <RefreshCw size={13} className={fetchingMeta ? 'animate-spin' : ''} /> Fetch
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Abstract</label>
                <textarea value={editAbstract} onChange={e => setEditAbstract(e.target.value)} rows={5}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none" />
              </div>
              {fetchedMeta && (
                <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-600 space-y-1">
                  {fetchedMeta.authors && fetchedMeta.authors.length > 0 && (
                    <p><span className="font-medium">Authors: </span>
                      {fetchedMeta.authors.slice(0, 5).join(', ')}
                      {fetchedMeta.authors.length > 5 ? ` +${fetchedMeta.authors.length - 5} more` : ''}
                    </p>
                  )}
                  {fetchedMeta.year && <p><span className="font-medium">Year: </span>{fetchedMeta.year}</p>}
                  {fetchedMeta.venue && <p><span className="font-medium">Venue: </span>{fetchedMeta.venue}</p>}
                  <p className="text-gray-400 pt-0.5">Source: {fetchedMeta.source === 'semantic_scholar' ? 'Semantic Scholar' : 'OpenAlex'}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setEditingInfo(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">Cancel</button>
              <button onClick={handleSaveInfo} disabled={savingInfo}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
                {savingInfo ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Similarity paper-picker dialog */}
      {similaritySelector && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">Similar Passages</h3>
              <button onClick={() => setSimilaritySelector(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <X size={15} />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">Select a paper to open in the other panel:</p>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {similaritySelector.papers.map(p => (
                <button key={p.paperId} onClick={() => handleSelectSimilarityPaper(p.paperId, p.matches)}
                  className="w-full text-left p-3 border border-gray-100 hover:border-purple-300 hover:bg-purple-50 transition-colors flex items-center justify-between rounded-xl">
                  <div className="min-w-0 pr-3">
                    <p className="text-xs font-semibold text-gray-700 truncate">{p.title}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{p.matches.length} matching passage{p.matches.length !== 1 ? 's' : ''}</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-600 border border-purple-100 rounded-full font-medium flex-shrink-0">
                    {Math.round(p.maxSimilarity * 100)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
