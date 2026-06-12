import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { api, type Passage, type Rect } from '../api';
import { X, Minus, Plus } from 'lucide-react';

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

interface Props {
  paperId: number;
  passages: Passage[];
  selectedPassage: Passage | null;
  onPassageCreated: (passage: Passage) => void;
  onPassageClick: (passage: Passage) => void;
  jumpToPage?: number;
}

export function PDFPanel({ paperId, passages, selectedPassage, onPassageCreated, onPassageClick, jumpToPage }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [selectedColor, setSelectedColor] = useState(HIGHLIGHT_COLORS[0]);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const pdfUrl = api.getPaperPdfUrl(paperId);

  // Jump to page when requested
  useEffect(() => {
    if (jumpToPage == null) return;
    const el = pageRefs.current[jumpToPage];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [jumpToPage]);

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

  const passagesByPage = passages.reduce<Record<number, Passage[]>>((acc, p) => {
    (acc[p.page] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="relative flex flex-col h-full bg-gray-100">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0">
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
            >
              <Page
                pageIndex={i}
                scale={scale}
                renderTextLayer
                renderAnnotationLayer={false}
              />

              {/* Highlight overlay */}
              <div className="absolute inset-0 pointer-events-none">
                {(passagesByPage[i] ?? []).map(passage => (
                  <div key={passage.id}>
                    {passage.rects.map((rect, ri) => (
                      <div
                        key={ri}
                        className="absolute cursor-pointer pointer-events-auto"
                        style={{
                          left: `${rect.x * 100}%`,
                          top: `${rect.y * 100}%`,
                          width: `${rect.width * 100}%`,
                          height: `${rect.height * 100}%`,
                          backgroundColor: passage.color,
                          opacity: selectedPassage?.id === passage.id ? 0.6 : 0.35,
                          outline: selectedPassage?.id === passage.id ? `2px solid ${passage.color}` : 'none',
                        }}
                        onClick={() => onPassageClick(passage)}
                      />
                    ))}
                  </div>
                ))}
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
