import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import {
  Minus, Plus, Trash2, MessageSquarePlus, StickyNote, TextCursor, SquareDashed, X,
} from 'lucide-react';
import type { Annotation, QuoteContext, Rect } from '../api';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url,
).toString();

const HIGHLIGHT_COLORS = ['#FDE047', '#86EFAC', '#93C5FD', '#F9A8D4', '#FCA5A5'];

type Mode = 'select' | 'region' | 'note';

interface PendingText {
  text: string;
  rects: Rect[];
  page: number;
  x: number;
  y: number;
}

interface RegionMenu {
  page: number;
  rect: Rect;
  x: number;
  y: number;
}

interface CommentEditor {
  id: string | null; // null => a not-yet-created note
  page: number;
  rect: Rect;
  value: string;
  x: number;
  y: number;
}

interface Props {
  pdfUrl: string;
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreateHighlight: (a: { page: number; rects: Rect[]; color: string }) => void;
  onCreateRegion: (a: { page: number; rect: Rect; color: string }) => void;
  onCreateNote: (a: { page: number; rect: Rect; color: string; comment: string }) => void;
  onUpdateComment: (id: string, comment: string) => void;
  onDelete: (id: string) => void;
  onAskAbout: (q: QuoteContext) => void;
  regionText: (page: number, rect: Rect) => Promise<string>;
  jumpTarget?: { page: number; rect?: Rect } | null;
  flash?: { page: number; rects: Rect[] } | null;
}

function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  };
}

function hitTest(anns: Annotation[], mx: number, my: number): Annotation | undefined {
  return anns.find(a => a.rects.some(r => mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height));
}

export function PDFPanel({
  pdfUrl, annotations, selectedId, onSelect,
  onCreateHighlight, onCreateRegion, onCreateNote, onUpdateComment, onDelete,
  onAskAbout, regionText, jumpTarget, flash,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [mode, setMode] = useState<Mode>('select');
  const [selectedColor, setSelectedColor] = useState(HIGHLIGHT_COLORS[0]);
  const [pendingText, setPendingText] = useState<PendingText | null>(null);
  const [regionDraft, setRegionDraft] = useState<{ page: number; rect: Rect } | null>(null);
  const [regionMenu, setRegionMenu] = useState<RegionMenu | null>(null);
  const [editor, setEditor] = useState<CommentEditor | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<{ page: number; startX: number; startY: number } | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverSoon = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setHoveredId(null), 250);
  };
  const keepHover = (id: string) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setHoveredId(prev => (prev === id ? prev : id));
  };

  const byPage = useMemo(() => {
    const m: Record<number, Annotation[]> = {};
    for (const a of annotations) (m[a.page] ??= []).push(a);
    return m;
  }, [annotations]);

  // Ctrl+wheel / pinch zoom, PDF only
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setScale(s => Math.min(2.5, Math.max(0.6, s + (e.deltaY < 0 ? 0.08 : -0.08))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Jump to a page / rect
  useEffect(() => {
    if (!jumpTarget) return;
    const pageEl = pageRefs.current[jumpTarget.page];
    const container = containerRef.current;
    if (!pageEl || !container) return;
    const cr = container.getBoundingClientRect();
    const pr = pageEl.getBoundingClientRect();
    const midFrac = jumpTarget.rect ? jumpTarget.rect.y + jumpTarget.rect.height / 2 : 0.1;
    const midY = pr.top + midFrac * pr.height;
    container.scrollTo({ top: container.scrollTop + midY - cr.top - cr.height / 2, behavior: 'instant' });
  }, [jumpTarget, numPages]);

  const pageMetrics = (pageIndex: number, clientX: number, clientY: number) => {
    const el = pageRefs.current[pageIndex];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { b, mx: (clientX - b.left) / b.width, my: (clientY - b.top) / b.height };
  };

  // ---- Text selection -> highlight / ask ----
  const handleTextMouseUp = useCallback((e: React.MouseEvent) => {
    if (mode !== 'select') return;
    if ((e.target as HTMLElement).closest('[data-overlay-ui]')) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setPendingText(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 3) {
      setPendingText(null);
      return;
    }
    const clientRects = Array.from(sel.getRangeAt(0).getClientRects());

    let pageIndex = -1;
    for (let i = 0; i < pageRefs.current.length; i++) {
      const el = pageRefs.current[i];
      if (!el) continue;
      const bb = el.getBoundingClientRect();
      if (clientRects.some(r => r.top >= bb.top - 4 && r.bottom <= bb.bottom + 10)) {
        pageIndex = i;
        break;
      }
    }
    if (pageIndex === -1) return;
    const pb = pageRefs.current[pageIndex]!.getBoundingClientRect();
    const rects = clientRects
      .filter(r => r.width > 1 && r.height > 1)
      .map(r => ({
        x: (r.left - pb.left) / pb.width,
        y: (r.top - pb.top) / pb.height,
        width: r.width / pb.width,
        height: r.height / pb.height,
      }));
    if (!rects.length) return;

    const cb = containerRef.current!.getBoundingClientRect();
    const last = clientRects[clientRects.length - 1];
    setPendingText({
      text,
      rects,
      page: pageIndex,
      y: last.bottom - cb.top + containerRef.current!.scrollTop + 8,
      x: Math.min(last.left - cb.left, cb.width - 240),
    });
  }, [mode]);

  const commitHighlight = () => {
    if (!pendingText) return;
    onCreateHighlight({ page: pendingText.page, rects: pendingText.rects, color: selectedColor });
    setPendingText(null);
    window.getSelection()?.removeAllRanges();
  };

  const askAboutText = () => {
    if (!pendingText) return;
    onAskAbout({ page: pendingText.page, rects: pendingText.rects, text: pendingText.text, kind: 'text' });
    setPendingText(null);
    window.getSelection()?.removeAllRanges();
  };

  // ---- Region drag ----
  const onPagePointerDown = (e: React.PointerEvent, pageIndex: number) => {
    if (mode !== 'region') return;
    const m = pageMetrics(pageIndex, e.clientX, e.clientY);
    if (!m) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { page: pageIndex, startX: m.mx, startY: m.my };
    setRegionMenu(null);
    setRegionDraft({ page: pageIndex, rect: { x: m.mx, y: m.my, width: 0, height: 0 } });
  };

  const onPagePointerMove = (e: React.PointerEvent, pageIndex: number) => {
    if (mode === 'select') {
      if ((e.target as HTMLElement).closest('[data-overlay-ui]')) return;
      const m = pageMetrics(pageIndex, e.clientX, e.clientY);
      if (!m) return;
      const hit = hitTest(byPage[pageIndex] ?? [], m.mx, m.my);
      if (hit) keepHover(hit.id);
      else clearHoverSoon();
      return;
    }
    if (mode !== 'region' || !dragRef.current || dragRef.current.page !== pageIndex) return;
    const m = pageMetrics(pageIndex, e.clientX, e.clientY);
    if (!m) return;
    setRegionDraft({
      page: pageIndex,
      rect: rectFromPoints(dragRef.current.startX, dragRef.current.startY, m.mx, m.my),
    });
  };

  const onPagePointerUp = (e: React.PointerEvent, pageIndex: number) => {
    if (mode !== 'region' || !dragRef.current) return;
    const drag = dragRef.current;
    dragRef.current = null;
    const m = pageMetrics(pageIndex, e.clientX, e.clientY);
    setRegionDraft(null);
    if (!m) return;
    const rect = rectFromPoints(drag.startX, drag.startY, m.mx, m.my);
    if (rect.width < 0.01 || rect.height < 0.01) return;
    const cb = containerRef.current!.getBoundingClientRect();
    setRegionMenu({
      page: pageIndex,
      rect,
      x: Math.min(e.clientX - cb.left, cb.width - 240),
      y: e.clientY - cb.top + containerRef.current!.scrollTop + 8,
    });
  };

  const commitRegion = () => {
    if (!regionMenu) return;
    onCreateRegion({ page: regionMenu.page, rect: regionMenu.rect, color: selectedColor });
    setRegionMenu(null);
    setMode('select');
  };

  const askAboutRegion = async () => {
    if (!regionMenu) return;
    const { page, rect } = regionMenu;
    setRegionMenu(null);
    setMode('select');
    const text = await regionText(page, rect);
    onAskAbout({ page, rects: [rect], text, kind: 'region' });
  };

  // ---- Note placement + comment editing ----
  const handlePageClick = (e: React.MouseEvent, pageIndex: number) => {
    if ((e.target as HTMLElement).closest('[data-overlay-ui]')) return;
    const m = pageMetrics(pageIndex, e.clientX, e.clientY);
    if (!m) return;

    if (mode === 'note') {
      const cb = containerRef.current!.getBoundingClientRect();
      setEditor({
        id: null,
        page: pageIndex,
        rect: { x: m.mx, y: m.my, width: 0.02, height: 0.02 },
        value: '',
        x: Math.min(e.clientX - cb.left, cb.width - 260),
        y: e.clientY - cb.top + containerRef.current!.scrollTop + 8,
      });
      return;
    }
    if (mode === 'select') {
      const hit = hitTest(byPage[pageIndex] ?? [], m.mx, m.my);
      onSelect(hit?.id ?? null);
    }
  };

  const openCommentEditor = (a: Annotation) => {
    const pageEl = pageRefs.current[a.page];
    const cb = containerRef.current?.getBoundingClientRect();
    if (!pageEl || !cb) return;
    const pr = pageEl.getBoundingClientRect();
    const r = a.rects[0];
    setEditor({
      id: a.id,
      page: a.page,
      rect: r,
      value: a.comment,
      x: Math.min(pr.left - cb.left + r.x * pr.width, cb.width - 260),
      y: (pr.top - cb.top) + (r.y + r.height) * pr.height + containerRef.current!.scrollTop + 6,
    });
  };

  const saveEditor = () => {
    if (!editor) return;
    if (editor.id) {
      onUpdateComment(editor.id, editor.value.trim());
    } else if (editor.value.trim()) {
      onCreateNote({ page: editor.page, rect: editor.rect, color: selectedColor, comment: editor.value.trim() });
      setMode('select');
    }
    setEditor(null);
  };

  const modeBtn = (m: Mode, label: string, Icon: typeof TextCursor) => (
    <button
      onClick={() => { setMode(m); setPendingText(null); setRegionMenu(null); }}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
        mode === m ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'
      }`}
      title={label}
    >
      <Icon size={13} /> {label}
    </button>
  );

  return (
    <div className="relative flex flex-col h-full bg-gray-100">
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
        <div className="flex items-center gap-1">
          {modeBtn('select', 'Select', TextCursor)}
          {modeBtn('region', 'Region', SquareDashed)}
          {modeBtn('note', 'Note', StickyNote)}
        </div>
        <p className="text-xs text-gray-400 w-16 text-right">{numPages} pp</p>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-4 relative"
        style={mode === 'select' ? { userSelect: 'text' } : { userSelect: 'none', cursor: 'crosshair' }}
        onMouseUp={handleTextMouseUp}
      >
        <Document
          file={pdfUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          className="flex flex-col items-center gap-4"
        >
          {Array.from({ length: numPages }, (_, i) => {
            const anns = byPage[i] ?? [];
            return (
              <div
                key={i}
                ref={el => { pageRefs.current[i] = el; }}
                className="relative shadow-lg"
                onPointerDown={e => onPagePointerDown(e, i)}
                onPointerMove={e => onPagePointerMove(e, i)}
                onPointerUp={e => onPagePointerUp(e, i)}
                onMouseLeave={clearHoverSoon}
                onClick={e => handlePageClick(e, i)}
              >
                <Page pageIndex={i} scale={scale} renderTextLayer renderAnnotationLayer={false} />

                <div className="absolute inset-0 pointer-events-none">
                  {anns.map(a => {
                    const active = selectedId === a.id || hoveredId === a.id;
                    const first = a.rects[0];
                    return (
                      <div key={a.id} style={{ position: 'static' }}>
                        {a.kind === 'highlight' && a.rects.map((r, ri) => (
                          <div
                            key={ri}
                            className="absolute pointer-events-none"
                            style={{
                              left: `${r.x * 100}%`, top: `${r.y * 100}%`,
                              width: `${r.width * 100}%`, height: `${r.height * 100}%`,
                              backgroundColor: a.color,
                              opacity: active ? 0.6 : 0.35,
                              outline: selectedId === a.id ? `2px solid ${a.color}` : 'none',
                            }}
                          />
                        ))}

                        {a.kind === 'region' && first && (
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: `${first.x * 100}%`, top: `${first.y * 100}%`,
                              width: `${first.width * 100}%`, height: `${first.height * 100}%`,
                              border: `2px solid ${a.color}`,
                              backgroundColor: a.color,
                              opacity: active ? 0.28 : 0.14,
                              borderRadius: 2,
                            }}
                          />
                        )}

                        {a.kind === 'note' && first && (
                          <div
                            data-overlay-ui
                            className="absolute z-30 pointer-events-auto"
                            style={{ left: `${first.x * 100}%`, top: `${first.y * 100}%` }}
                          >
                            <button
                              onClick={e => { e.stopPropagation(); onSelect(a.id); openCommentEditor(a); }}
                              className="w-5 h-5 rounded-full flex items-center justify-center shadow-sm"
                              style={{ backgroundColor: a.color }}
                              title={a.comment || 'Note'}
                            >
                              <StickyNote size={10} className="text-gray-800" />
                            </button>
                          </div>
                        )}

                        {/* comment badge for highlight / region */}
                        {a.kind !== 'note' && a.comment && first && (
                          <div
                            data-overlay-ui
                            className="absolute z-30 pointer-events-auto"
                            style={{
                              left: `calc(${(first.x + first.width) * 100}% - 8px)`,
                              top: `calc(${first.y * 100}% - 8px)`,
                            }}
                          >
                            <button
                              onClick={e => { e.stopPropagation(); onSelect(a.id); openCommentEditor(a); }}
                              className="w-5 h-5 bg-amber-400 rounded-full flex items-center justify-center shadow-sm hover:bg-amber-500"
                              title="Edit comment"
                            >
                              <StickyNote size={9} className="text-white" />
                            </button>
                          </div>
                        )}

                        {/* hover toolbar */}
                        {active && first && (
                          <div
                            data-overlay-ui
                            className="absolute z-40 pointer-events-auto flex items-center gap-0.5 bg-white rounded-lg shadow-lg border border-gray-200 px-1.5 py-1"
                            style={{ left: `${first.x * 100}%`, top: `calc(${first.y * 100}% - 34px)` }}
                          >
                            <button
                              onClick={e => { e.stopPropagation(); onSelect(a.id); openCommentEditor(a); }}
                              className="p-1 text-gray-500 hover:text-amber-600 rounded hover:bg-amber-50"
                              title={a.comment ? 'Edit comment' : 'Add comment'}
                            >
                              <MessageSquarePlus size={13} />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); onDelete(a.id); }}
                              className="p-1 text-gray-500 hover:text-red-500 rounded hover:bg-red-50"
                              title="Delete"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* region drag preview */}
                  {regionDraft?.page === i && (
                    <div
                      className="absolute pointer-events-none border-2 border-dashed"
                      style={{
                        left: `${regionDraft.rect.x * 100}%`, top: `${regionDraft.rect.y * 100}%`,
                        width: `${regionDraft.rect.width * 100}%`, height: `${regionDraft.rect.height * 100}%`,
                        borderColor: selectedColor, backgroundColor: selectedColor, opacity: 0.25,
                      }}
                    />
                  )}

                  {/* transient flash from chat "possible locations" */}
                  {flash?.page === i && flash.rects.map((r, ri) => (
                    <div
                      key={`flash-${ri}`}
                      className="absolute pointer-events-none animate-pulse"
                      style={{
                        left: `${r.x * 100}%`, top: `${r.y * 100}%`,
                        width: `${r.width * 100}%`, height: `${r.height * 100}%`,
                        backgroundColor: '#7c3aed', opacity: 0.35, outline: '2px solid #7c3aed', borderRadius: 2,
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </Document>

        {/* text-selection popover */}
        {pendingText && (
          <div
            data-overlay-ui
            className="absolute z-50 bg-white rounded-xl shadow-lg border border-gray-200 p-3 flex flex-col gap-2"
            style={{ top: pendingText.y, left: pendingText.x, width: 230 }}
          >
            <p className="text-xs text-gray-500 truncate">"{pendingText.text.slice(0, 60)}{pendingText.text.length > 60 ? '…' : ''}"</p>
            <div className="flex items-center gap-1.5">
              {HIGHLIGHT_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setSelectedColor(c)}
                  className="w-5 h-5 rounded-full border-2 hover:scale-110 transition-transform"
                  style={{ backgroundColor: c, borderColor: selectedColor === c ? '#374151' : 'transparent' }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={commitHighlight} className="flex-1 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                Highlight
              </button>
              <button onClick={askAboutText} className="flex-1 py-1 bg-gray-100 text-gray-700 text-xs rounded-lg hover:bg-gray-200">
                Ask about this
              </button>
              <button
                onClick={() => { setPendingText(null); window.getSelection()?.removeAllRanges(); }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* region action popover */}
        {regionMenu && (
          <div
            data-overlay-ui
            className="absolute z-50 bg-white rounded-xl shadow-lg border border-gray-200 p-3 flex flex-col gap-2"
            style={{ top: regionMenu.y, left: regionMenu.x, width: 230 }}
          >
            <div className="flex items-center gap-1.5">
              {HIGHLIGHT_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setSelectedColor(c)}
                  className="w-5 h-5 rounded-full border-2 hover:scale-110 transition-transform"
                  style={{ backgroundColor: c, borderColor: selectedColor === c ? '#374151' : 'transparent' }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={commitRegion} className="flex-1 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                Highlight
              </button>
              <button onClick={askAboutRegion} className="flex-1 py-1 bg-gray-100 text-gray-700 text-xs rounded-lg hover:bg-gray-200">
                Ask about this
              </button>
              <button onClick={() => { setRegionMenu(null); setMode('select'); }} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* comment editor */}
        {editor && (
          <div
            data-overlay-ui
            className="absolute z-50 bg-white rounded-xl shadow-lg border border-gray-200 p-3 flex flex-col gap-2"
            style={{ top: editor.y, left: editor.x, width: 250 }}
          >
            <textarea
              autoFocus
              value={editor.value}
              onChange={e => setEditor({ ...editor, value: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEditor();
                if (e.key === 'Escape') setEditor(null);
              }}
              rows={3}
              placeholder="Comment…"
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={saveEditor} className="flex-1 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                Save
              </button>
              {editor.id && (
                <button
                  onClick={() => { onUpdateComment(editor.id!, ''); setEditor(null); }}
                  className="px-2 py-1 text-gray-500 hover:text-red-500 text-xs rounded-lg"
                  title="Remove comment"
                >
                  Clear
                </button>
              )}
              <button onClick={() => setEditor(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
