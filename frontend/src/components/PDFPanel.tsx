import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { api, type Passage, type Rect, type Tag } from '../api';
import { X, Minus, Plus, Tag as TagIcon, Trash2, Link2, Unlink, Sparkles } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url,
).toString();

const HIGHLIGHT_COLORS = ['#FDE047', '#86EFAC', '#93C5FD', '#F9A8D4', '#FCA5A5'];

interface PendingSelection {
  text: string;
  rects: Rect[];
  page: number;
  toolbarY: number;
  toolbarX: number;
}

interface ConnectedPassage {
  page: number;
  rects: Rect[];
  highlight?: boolean; // render a visual highlight (for the second panel)
  passageId?: number;
}

interface Props {
  paperId: number;
  projectId: number;
  passages: Passage[];
  selectedPassage: Passage | null;
  onPassageCreated: (passage: Passage) => void;
  onPassageClick: (passage: Passage) => void;
  onPassageDeleted: (id: number) => void;
  onPassageUpdated: (passage: Passage) => void;
  jumpToPage?: number;
  jumpToPassage?: { page: number; rect: Rect };
  connectedPassages?: ConnectedPassage[];
  onConnectedRectsChange?: (rects: { passageId: number; rect: DOMRect }[]) => void;
  onOffscreenRectsChange?: (rects: DOMRect[]) => void;
  // Linking
  onLinkStart?: (passage: Passage, sourceRect: DOMRect | null) => void;
  linkingTarget?: boolean;
  onLinkTarget?: (passage: Passage) => void;
  linkedPassages?: { page: number; rects: Rect[]; passageId: number }[];
  onLinkedRectsChange?: (rects: { passageId: number; rect: DOMRect }[]) => void;
  onUnlink?: (passageId: number) => void;
  onFindSimilar?: (passage: Passage) => void;
  onPassageHover?: (passageId: number | null) => void;
}

export function PDFPanel({ paperId, projectId, passages, selectedPassage, onPassageCreated, onPassageClick, onPassageDeleted, onPassageUpdated, jumpToPage, jumpToPassage, connectedPassages, onConnectedRectsChange, onOffscreenRectsChange, onLinkStart, linkingTarget, onLinkTarget, linkedPassages, onLinkedRectsChange, onUnlink, onFindSimilar, onPassageHover }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [selectedColor, setSelectedColor] = useState(HIGHLIGHT_COLORS[0]);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [hoveredPassageId, setHoveredPassageId] = useState<number | null>(null);
  const [taggingPassageId, setTaggingPassageId] = useState<number | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!onConnectedRectsChange && !onOffscreenRectsChange) return;
    const compute = () => {
      if (!connectedPassages?.length) {
        onConnectedRectsChange?.([]);
        onOffscreenRectsChange?.([]);
        return;
      }
      const cb = containerRef.current?.getBoundingClientRect();
      if (!cb) { onConnectedRectsChange?.([]); onOffscreenRectsChange?.([]); return; }
      const visible: { passageId: number; rect: DOMRect }[] = [];
      for (const cp of connectedPassages) {
        const pageEl = pageRefs.current[cp.page];
        if (!pageEl) continue;
        const pb = pageEl.getBoundingClientRect();
        const r = cp.rects[0];
        const isNormalized = r && r.x <= 2 && r.y <= 2;
        const midY = isNormalized
          ? pb.top + (r.y + r.height / 2) * pb.height
          : pb.top + pb.height * 0.1;
        const rawLeft = isNormalized ? pb.left + r.x * pb.width : pb.left + pb.width * 0.1;
        const rawRight = isNormalized ? rawLeft + r.width * pb.width : pb.left + pb.width * 0.9;
        const clampedLeft = Math.max(rawLeft, cb.left);
        const clampedRight = Math.min(rawRight, cb.right);
        if (clampedRight > clampedLeft) {
          visible.push({
            passageId: cp.passageId ?? 0,
            rect: new DOMRect(clampedLeft, midY, clampedRight - clampedLeft, 0)
          });
        }
      }
      onConnectedRectsChange?.(visible);
      onOffscreenRectsChange?.([]);
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(compute));
    const el = containerRef.current;
    el?.addEventListener('scroll', compute);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      el?.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
    };
  }, [connectedPassages, scale, numPages, onConnectedRectsChange, onOffscreenRectsChange]);

  useEffect(() => {
    if (!onLinkedRectsChange) return;
    if (!linkedPassages?.length) { onLinkedRectsChange([]); return; }
    const compute = () => {
      const cb = containerRef.current?.getBoundingClientRect();
      if (!cb) { onLinkedRectsChange([]); return; }
      const result: { passageId: number; rect: DOMRect }[] = [];
      for (const lp of linkedPassages) {
        const pageEl = pageRefs.current[lp.page];
        if (!pageEl) continue;
        const pb = pageEl.getBoundingClientRect();
        const r = lp.rects[0];
        if (!r) continue;
        const midY = pb.top + (r.y + r.height / 2) * pb.height;
        const rawLeft = pb.left + r.x * pb.width;
        const rawRight = rawLeft + r.width * pb.width;
        const clampedLeft = Math.max(rawLeft, cb.left);
        const clampedRight = Math.min(rawRight, cb.right);
        if (clampedRight > clampedLeft) {
          result.push({ passageId: lp.passageId, rect: new DOMRect(clampedLeft, midY, clampedRight - clampedLeft, 0) });
        }
      }
      onLinkedRectsChange(result);
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(compute));
    const el = containerRef.current;
    el?.addEventListener('scroll', compute);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      el?.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
    };
  }, [linkedPassages, scale, numPages, onLinkedRectsChange]);

  useEffect(() => {
    api.listTags(projectId).then(setTags);
  }, [projectId]);

  const pdfUrl = api.getPaperPdfUrl(paperId);

  useEffect(() => {
    if (jumpToPage == null) return;
    const el = pageRefs.current[jumpToPage];
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
  }, [jumpToPage, numPages]);

  useEffect(() => {
    if (!jumpToPassage) return;
    const pageEl = pageRefs.current[jumpToPassage.page];
    const container = containerRef.current;
    if (!pageEl || !container) return;
    const containerRect = container.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    const r = jumpToPassage.rect;
    const passageMidY = pageRect.top + (r.y + r.height / 2) * pageRect.height;
    const targetScrollTop = container.scrollTop + passageMidY - containerRect.top - containerRect.height / 2;
    container.scrollTo({ top: targetScrollTop, behavior: 'instant' });
  }, [jumpToPassage, numPages]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Don't capture if clicking on the toolbar itself
    if ((e.target as HTMLElement).closest('[data-highlight-toolbar]')) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setPending(null);
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 5) {
      setPending(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const clientRects = Array.from(range.getClientRects());

    // Find which page this selection is in
    let pageIndex = -1;
    for (let i = 0; i < pageRefs.current.length; i++) {
      const el = pageRefs.current[i];
      if (!el) continue;
      const bounds = el.getBoundingClientRect();
      if (clientRects.some(r => r.top >= bounds.top && r.bottom <= bounds.bottom + 10)) {
        pageIndex = i;
        break;
      }
    }
    if (pageIndex === -1) return;

    const pageEl = pageRefs.current[pageIndex]!;
    const pageBounds = pageEl.getBoundingClientRect();

    const rects: Rect[] = clientRects
      .filter(r => r.width > 1 && r.height > 1)
      .map(r => ({
        x: (r.left - pageBounds.left) / pageBounds.width,
        y: (r.top - pageBounds.top) / pageBounds.height,
        width: r.width / pageBounds.width,
        height: r.height / pageBounds.height,
      }));

    if (rects.length === 0) return;

    // Position toolbar near the selection
    const containerBounds = containerRef.current!.getBoundingClientRect();
    const lastRect = clientRects[clientRects.length - 1];

    setPending({
      text,
      rects,
      page: pageIndex,
      toolbarY: lastRect.bottom - containerBounds.top + containerRef.current!.scrollTop + 8,
      toolbarX: Math.min(
        lastRect.left - containerBounds.left,
        containerBounds.width - 220
      ),
    });
  }, []);

  const handleCreatePassage = async () => {
    if (!pending) return;
    const passage = await api.createPassage(paperId, {
      page: pending.page,
      text: pending.text,
      rects: pending.rects,
      color: selectedColor,
    });
    onPassageCreated(passage);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  const handlePageMouseMove = (e: React.MouseEvent<HTMLDivElement>, pageIndex: number) => {
    if (taggingPassageId !== null) return;
    if ((e.target as HTMLElement).closest('[data-passage-toolbar]')) {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
      return;
    }
    const el = pageRefs.current[pageIndex];
    if (!el) return;
    const bounds = el.getBoundingClientRect();
    const mx = (e.clientX - bounds.left) / bounds.width;
    const my = (e.clientY - bounds.top) / bounds.height;
    const hit = (passagesByPage[pageIndex] ?? []).find(p =>
      p.rects.some(r => mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height)
    );
    if (hit) {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
      if (hoveredPassageId !== hit.id) {
        setHoveredPassageId(hit.id);
        onPassageHover?.(hit.id);
      }
    } else {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
      hoverTimeout.current = setTimeout(() => {
        setHoveredPassageId(null);
        onPassageHover?.(null);
      }, 300);
    }
  };

  const handleDeletePassage = async (id: number) => {
    await api.deletePassage(id);
    onPassageDeleted(id);
    setTaggingPassageId(null);
  };

  const handleAddTag = async (tag: Tag, passage: Passage) => {
    await api.addPassageTag(passage.id, tag.id);
    onPassageUpdated({ ...passage, tags: [...passage.tags, tag] });
    setTaggingPassageId(null);
  };

  const handleRemoveTag = async (tagId: number, passage: Passage) => {
    await api.removePassageTag(passage.id, tagId);
    onPassageUpdated({ ...passage, tags: passage.tags.filter(t => t.id !== tagId) });
    const stillUsed = passages.some(p => p.id !== passage.id && p.tags.some(t => t.id === tagId));
    if (!stillUsed) setTags(prev => prev.filter(t => t.id !== tagId));
  };

  const handleCreateTag = async (passage: Passage) => {
    if (!newTagName.trim()) return;
    const tag = await api.createTag(newTagName.trim(), 'content', projectId);
    setTags(prev => [...prev, tag]);
    setNewTagName('');
    setAddingTag(false);
    await handleAddTag(tag, passage);
  };

  const passagesByPage = passages.reduce<Record<number, Passage[]>>((acc, p) => {
    (acc[p.page] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="relative flex flex-col h-full bg-gray-100">
      {/* Toolbar */}
      <div className="relative z-20 flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => setScale(s => Math.max(0.6, s - 0.2))} className="p-1 rounded hover:bg-gray-100">
            <Minus size={14} />
          </button>
          <span className="text-xs text-gray-500 w-10 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(2.5, s + 0.2))} className="p-1 rounded hover:bg-gray-100">
            <Plus size={14} />
          </button>
        </div>
        <p className="text-xs text-gray-400">{numPages} pages · Select text to highlight</p>
      </div>

      {/* PDF + highlights */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-4 relative select-text"
        style={linkingTarget ? { cursor: 'crosshair' } : undefined}
        onMouseUp={handleMouseUp}
      >
        <Document
          file={pdfUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          className="flex flex-col items-center gap-4"
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div
              key={i}
              ref={el => { pageRefs.current[i] = el; }}
              className="relative shadow-lg"
              onMouseMove={e => handlePageMouseMove(e, i)}
              onMouseLeave={() => { if (taggingPassageId === null) { if (hoverTimeout.current) clearTimeout(hoverTimeout.current); hoverTimeout.current = setTimeout(() => { setHoveredPassageId(null); onPassageHover?.(null); }, 300); } }}
              onClick={e => {
                const el = pageRefs.current[i];
                if (!el) return;
                const bounds = el.getBoundingClientRect();
                const mx = (e.clientX - bounds.left) / bounds.width;
                const my = (e.clientY - bounds.top) / bounds.height;
                const hit = (passagesByPage[i] ?? []).find(p =>
                  p.rects.some(r => mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height)
                );
                if (hit) {
                  if (linkingTarget && onLinkTarget) onLinkTarget(hit);
                  else onPassageClick(hit);
                }
              }}
            >
              <Page
                pageIndex={i}
                scale={scale}
                renderTextLayer
                renderAnnotationLayer={false}
              />

              {/* Highlight overlay */}
              <div className="absolute inset-0 pointer-events-none">
                {(passagesByPage[i] ?? []).map(passage => {
                  const isTagging = taggingPassageId === passage.id;
                  const firstRect = passage.rects[0];
                  const passageTagIds = new Set(passage.tags.map(t => t.id));
                  const availableTags = tags.filter(t => !passageTagIds.has(t.id) && t.type === 'content');
                  const isHovered = hoveredPassageId === passage.id;
                  const isLinked = linkedPassages?.some(lp => lp.passageId === passage.id) ?? false;
                  return (
                    <div key={passage.id} style={{ position: 'static' }}>
                      {passage.rects.map((rect, ri) => (
                        <div
                          key={ri}
                          className="absolute pointer-events-none"
                          style={{
                            left: `${rect.x * 100}%`,
                            top: `${rect.y * 100}%`,
                            width: `${rect.width * 100}%`,
                            height: `${rect.height * 100}%`,
                            backgroundColor: passage.color,
                            opacity: selectedPassage?.id === passage.id ? 0.6 : 0.35,
                            outline: selectedPassage?.id === passage.id ? `2px solid ${passage.color}` : 'none',
                          }}
                        />
                      ))}

                      {/* Hover toolbar */}
                      {(isHovered || isTagging) && firstRect && (
                        <div
                          data-passage-toolbar
                          className="absolute z-50 pointer-events-auto flex items-center gap-0.5 bg-white rounded-lg shadow-lg border border-gray-200 px-1.5 py-1"
                          style={{
                            left: `${firstRect.x * 100}%`,
                            top: `calc(${firstRect.y * 100}% - 34px)`,
                          }}
                        >
                          <button
                            onClick={e => { e.stopPropagation(); setTaggingPassageId(isTagging ? null : passage.id); setNewTagName(''); setAddingTag(false); }}
                            className="p-1 text-gray-500 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors"
                            title="Add tag"
                          >
                            <TagIcon size={13} />
                          </button>
                          {onFindSimilar && (
                            <button
                              onClick={e => { e.stopPropagation(); onFindSimilar(passage); }}
                              className="p-1 text-gray-500 hover:text-purple-600 rounded hover:bg-purple-50 transition-colors"
                              title="Find similar passages"
                            >
                              <Sparkles size={13} />
                            </button>
                          )}
                          {onLinkStart && (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                const pageEl = pageRefs.current[passage.page];
                                const r = passage.rects[0];
                                let passageRect: DOMRect | null = null;
                                if (pageEl && r) {
                                  const pb = pageEl.getBoundingClientRect();
                                  passageRect = new DOMRect(pb.left + r.x * pb.width, pb.top + r.y * pb.height, r.width * pb.width, r.height * pb.height);
                                }
                                onLinkStart(passage, passageRect);
                              }}
                              className="p-1 text-gray-500 hover:text-teal-600 rounded hover:bg-teal-50 transition-colors"
                              title="Link to another passage"
                            >
                              <Link2 size={13} />
                            </button>
                          )}
                          {isLinked && onUnlink && (
                            <button
                              onClick={e => { e.stopPropagation(); onUnlink(passage.id); }}
                              className="p-1 text-teal-500 hover:text-red-500 rounded hover:bg-red-50 transition-colors"
                              title="Remove link"
                            >
                              <Unlink size={13} />
                            </button>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); handleDeletePassage(passage.id); }}
                            className="p-1 text-gray-500 hover:text-red-500 rounded hover:bg-red-50 transition-colors"
                            title="Delete highlight"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}

                      {/* Tag picker */}
                      {isTagging && firstRect && (
                        <div
                          data-passage-toolbar
                          className="absolute z-50 pointer-events-auto bg-white rounded-xl shadow-xl border border-gray-200 p-2 w-48"
                          style={{
                            left: `${firstRect.x * 100}%`,
                            top: `calc(${firstRect.y * 100}% - 38px)`,
                            transform: 'translateY(-100%)',
                          }}
                        >
                          {passage.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {passage.tags.map(tag => (
                                <span key={tag.id} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                                  {tag.name}
                                  <button onClick={() => handleRemoveTag(tag.id, passage)}>
                                    <X size={9} className="text-gray-400 hover:text-red-400" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          {!addingTag ? (
                            <div className="flex flex-wrap gap-1">
                              {availableTags.map(tag => (
                                <button
                                  key={tag.id}
                                  onClick={() => handleAddTag(tag, passage)}
                                  className="px-2 py-0.5 bg-white border border-dashed border-gray-300 rounded-full text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
                                >
                                  {tag.name}
                                </button>
                              ))}
                              <button
                                onClick={() => setAddingTag(true)}
                                className="px-2 py-0.5 bg-white border border-dashed border-gray-300 rounded-full text-xs text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center gap-1"
                              >
                                <Plus size={9} /> New
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-1.5">
                              <input
                                autoFocus
                                value={newTagName}
                                onChange={e => setNewTagName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleCreateTag(passage); if (e.key === 'Escape') setAddingTag(false); }}
                                placeholder="Tag name"
                                className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                              <button onClick={() => handleCreateTag(passage)} className="px-2 py-1 bg-blue-600 text-white text-xs rounded-lg">Add</button>
                              <button onClick={() => setAddingTag(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={12} /></button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Connected passage highlights (similarity — purple) */}
                {connectedPassages?.filter(cp => cp.highlight && cp.page === i).flatMap((cp, ci) =>
                  cp.rects.map((rect, ri) => (
                    <div
                      key={`conn-${ci}-${ri}`}
                      className="absolute pointer-events-none animate-pulse"
                      style={{
                        left: `${rect.x * 100}%`,
                        top: `${rect.y * 100}%`,
                        width: `${rect.width * 100}%`,
                        height: `${rect.height * 100}%`,
                        backgroundColor: '#7c3aed',
                        opacity: 0.4,
                        outline: '2.5px solid #7c3aed',
                        borderRadius: '2px',
                      }}
                    />
                  ))
                )}

                {/* Linking-target hover highlight */}
                {linkingTarget && hoveredPassageId !== null && (passagesByPage[i] ?? []).filter(p => p.id === hoveredPassageId).flatMap(p =>
                  p.rects.map((rect, ri) => (
                    <div
                      key={`lt-${ri}`}
                      className="absolute pointer-events-none"
                      style={{
                        left: `${rect.x * 100}%`,
                        top: `${rect.y * 100}%`,
                        width: `${rect.width * 100}%`,
                        height: `${rect.height * 100}%`,
                        backgroundColor: '#0d9488',
                        opacity: 0.35,
                        outline: '2.5px solid #0d9488',
                        borderRadius: '2px',
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </Document>

        {/* Pending highlight toolbar */}
        {pending && (
          <div
            data-highlight-toolbar
            className="absolute z-50 bg-white rounded-xl shadow-lg border border-gray-200 p-3 flex flex-col gap-2"
            style={{ top: pending.toolbarY, left: pending.toolbarX, width: 210 }}
          >
            <p className="text-xs text-gray-500 truncate">"{pending.text.slice(0, 60)}{pending.text.length > 60 ? '…' : ''}"</p>
            <div className="flex items-center gap-1.5">
              {HIGHLIGHT_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setSelectedColor(c)}
                  className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: selectedColor === c ? '#374151' : 'transparent',
                  }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreatePassage}
                className="flex-1 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"
              >
                Highlight
              </button>
              <button
                onClick={() => { setPending(null); window.getSelection()?.removeAllRanges(); }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
