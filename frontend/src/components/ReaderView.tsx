import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, PanelRight, Settings, MessagesSquare, ListChecks, RefreshCw } from 'lucide-react';
import type { Annotation, ChatMessage, ChatSession, ChunkResult, QuoteContext, Rect } from '../api';
import type { OpenedPdf } from '../services/pdfFile';
import { writeBack } from '../services/pdfFile';
import type { PaperCacheEntry } from '../services/paperCache';
import { getChats, saveChats } from '../services/paperCache';
import { chunksFromCache } from '../services/qaService';
import { extractRegionText } from '../services/pdfText';
import {
  readAnnotations, addHighlight, addRegion, addNote, updateComment, deleteAnnotation,
} from '../services/pdfAnnotations';
import { PDFPanel } from './PDFPanel';
import { ChatPanel } from './ChatPanel';
import { AnnotationsList } from './AnnotationsList';

interface Props {
  opened: OpenedPdf;
  cache: PaperCacheEntry;
  pdfUrl: string;
  embedProgress: { done: number; total: number } | null;
  onClose: () => void;
  onReprocess: () => Promise<void>;
  onOpenSettings: () => void;
}

function unionRect(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map(r => r.x));
  const y0 = Math.min(...rects.map(r => r.y));
  const x1 = Math.max(...rects.map(r => r.x + r.width));
  const y1 = Math.max(...rects.map(r => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const now = () => new Date().toISOString();

const newChatSession = (): ChatSession => ({
  id: crypto.randomUUID(),
  title: 'New chat',
  messages: [],
  updatedAt: now(),
});

const chatTitle = (messages: ChatMessage[]): string => {
  const first = messages.find(m => m.role === 'user')?.content.trim();
  return first ? (first.length > 48 ? first.slice(0, 48) + '…' : first) : 'New chat';
};

export function ReaderView({ opened, cache, pdfUrl, embedProgress, onClose, onReprocess, onOpenSettings }: Props) {
  const [reprocessing, setReprocessing] = useState(false);
  const embedding = embedProgress !== null;
  const busyIcon = reprocessing || embedding;
  const bytesRef = useRef<ArrayBuffer>(opened.bytes);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [jumpTarget, setJumpTarget] = useState<{ page: number; rect?: Rect } | null>(null);
  const [flash, setFlash] = useState<{ page: number; rects: Rect[] } | null>(null);
  const [pendingQuote, setPendingQuote] = useState<QuoteContext | null>(null);
  const [tab, setTab] = useState<'chat' | 'annotations'>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatFocusNonce, setChatFocusNonce] = useState(0);

  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState('');
  const chatsLoaded = useRef(false);

  const chunks = useMemo(() => chunksFromCache(cache), [cache]);

  // Load persisted chats for this paper (or start one).
  useEffect(() => {
    chatsLoaded.current = false;
    let cancelled = false;
    getChats(opened.hash).then(stored => {
      if (cancelled) return;
      const list = stored.length ? stored : [newChatSession()];
      setChats(list);
      setActiveChatId(list[0].id);
      chatsLoaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [opened.hash]);

  // Persist chats (skip the initial load).
  useEffect(() => {
    if (chatsLoaded.current && chats.length) saveChats(opened.hash, chats);
  }, [chats, opened.hash]);

  // Never let the active id dangle.
  useEffect(() => {
    if (chats.length && !chats.some(c => c.id === activeChatId)) setActiveChatId(chats[0].id);
  }, [chats, activeChatId]);

  const activeChat = chats.find(c => c.id === activeChatId) ?? chats[0] ?? null;

  const setActiveMessages = useCallback(
    (messages: ChatMessage[]) => {
      setChats(prev =>
        prev.map(c => (c.id === activeChatId ? { ...c, messages, title: chatTitle(messages), updatedAt: now() } : c)),
      );
    },
    [activeChatId],
  );

  const handleNewChat = useCallback(() => {
    setChats(prev => {
      // Reuse an existing empty chat instead of piling up blanks.
      const empty = prev.find(c => c.messages.length === 0);
      if (empty) {
        setActiveChatId(empty.id);
        return prev;
      }
      const s = newChatSession();
      setActiveChatId(s.id);
      return [s, ...prev];
    });
    setChatFocusNonce(n => n + 1);
  }, []);

  const handleDeleteChat = useCallback(
    (id: string) => {
      setChats(prev => {
        const next = prev.filter(c => c.id !== id);
        if (!next.length) {
          const s = newChatSession();
          setActiveChatId(s.id);
          return [s];
        }
        if (id === activeChatId) setActiveChatId(next[0].id);
        return next;
      });
    },
    [activeChatId],
  );

  // Hydrate annotations from the PDF itself, then recover their underlying text.
  useEffect(() => {
    let cancelled = false;
    bytesRef.current = opened.bytes;
    readAnnotations(opened.bytes)
      .then(async list => {
        if (cancelled) return;
        setAnnotations(list);
        const enriched = await Promise.all(
          list.map(async a => {
            if (a.kind === 'note' || a.text) return a;
            try {
              const text = await extractRegionText(opened.bytes, a.page, unionRect(a.rects));
              return text ? { ...a, text } : a;
            } catch {
              return a;
            }
          }),
        );
        if (!cancelled) setAnnotations(enriched);
      })
      .catch(err => console.error('Failed to read PDF annotations:', err));
    return () => {
      cancelled = true;
    };
  }, [opened]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  // Serialize annotation writes: each edit builds on the previous file bytes.
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const applyWrite = useCallback(
    (writer: (bytes: ArrayBuffer) => Promise<ArrayBuffer>) => {
      writeChain.current = writeChain.current.then(async () => {
        try {
          const next = await writer(bytesRef.current);
          bytesRef.current = next;
          writeBack(opened.handle, next);
        } catch (e) {
          console.error('Annotation write failed, resyncing:', e);
          const current = await readAnnotations(bytesRef.current).catch(() => null);
          if (current) setAnnotations(current);
        }
      });
      return writeChain.current;
    },
    [opened.handle],
  );

  const enrichText = useCallback((id: string, page: number, rects: Rect[]) => {
    extractRegionText(opened.bytes, page, unionRect(rects))
      .then(text => {
        if (text) setAnnotations(prev => prev.map(a => (a.id === id ? { ...a, text } : a)));
      })
      .catch(() => {});
  }, [opened.bytes]);

  const handleCreateHighlight = useCallback(
    ({ page, rects, color }: { page: number; rects: Rect[]; color: string }) => {
      const id = crypto.randomUUID();
      setAnnotations(prev => [...prev, { id, kind: 'highlight', page, rects, color, comment: '', updatedAt: now() }]);
      setSelectedId(id);
      applyWrite(b => addHighlight(b, { id, page, rects, color }));
      enrichText(id, page, rects);
    },
    [applyWrite, enrichText],
  );

  const handleCreateRegion = useCallback(
    ({ page, rect, color }: { page: number; rect: Rect; color: string }) => {
      const id = crypto.randomUUID();
      setAnnotations(prev => [...prev, { id, kind: 'region', page, rects: [rect], color, comment: '', updatedAt: now() }]);
      setSelectedId(id);
      applyWrite(b => addRegion(b, { id, page, rect, color }));
      enrichText(id, page, [rect]);
    },
    [applyWrite, enrichText],
  );

  const handleCreateNote = useCallback(
    ({ page, rect, color, comment }: { page: number; rect: Rect; color: string; comment: string }) => {
      const id = crypto.randomUUID();
      setAnnotations(prev => [...prev, { id, kind: 'note', page, rects: [rect], color, comment, updatedAt: now() }]);
      setSelectedId(id);
      applyWrite(b => addNote(b, { id, page, rect, color, comment }));
    },
    [applyWrite],
  );

  const handleUpdateComment = useCallback(
    (id: string, comment: string) => {
      setAnnotations(prev => prev.map(a => (a.id === id ? { ...a, comment, updatedAt: now() } : a)));
      applyWrite(b => updateComment(b, id, comment));
    },
    [applyWrite],
  );

  const handleDelete = useCallback(
    (id: string) => {
      setAnnotations(prev => prev.filter(a => a.id !== id));
      setSelectedId(prev => (prev === id ? null : prev));
      applyWrite(b => deleteAnnotation(b, id));
    },
    [applyWrite],
  );

  const handleAskAbout = useCallback((q: QuoteContext) => {
    setPendingQuote(q);
    setTab('chat');
    setSidebarOpen(true);
    setChatFocusNonce(n => n + 1);
  }, []);

  const handleJumpToLocation = useCallback((loc: ChunkResult) => {
    // Flash the whole paragraph as one block (its line rects unioned).
    const block = loc.rects.length ? unionRect(loc.rects) : undefined;
    setJumpTarget({ page: loc.page, rect: block });
    setFlash({ page: loc.page, rects: block ? [block] : [] });
  }, []);

  const handleJumpAnnotation = useCallback((a: Annotation) => {
    setJumpTarget({ page: a.page, rect: a.rects[0] });
  }, []);

  const regionText = useCallback(
    (page: number, rect: Rect) => extractRegionText(opened.bytes, page, rect),
    [opened.bytes],
  );

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <header className="relative z-20 flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 flex-shrink-0">
        <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="Close PDF">
          <ArrowLeft size={18} className="text-gray-500" />
        </button>
        <p className="text-sm font-semibold text-gray-700 truncate">{cache.title || opened.name}</p>
        <span className="text-[11px] text-gray-400 flex-shrink-0">
          {embedding
            ? `embedding ${embedProgress!.done}/${embedProgress!.total}`
            : cache.embeddingDim > 0
              ? 'embeddings ✓'
              : 'keyword search'}
        </span>
        <div className="flex-1" />
        <button
          onClick={async () => {
            if (busyIcon) return;
            setReprocessing(true);
            try {
              await onReprocess();
            } finally {
              setReprocessing(false);
            }
          }}
          disabled={busyIcon}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 disabled:opacity-60"
          title={
            embedding
              ? `Generating embeddings in the background (${embedProgress!.done}/${embedProgress!.total})`
              : 'Reprocess this PDF (re-chunk and re-embed with current settings)'
          }
        >
          <RefreshCw size={15} className={busyIcon ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className={`p-1.5 rounded-lg transition-colors ${sidebarOpen ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-400'}`}
          title="Toggle panel"
        >
          <PanelRight size={18} />
        </button>
        <button onClick={onOpenSettings} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="Settings">
          <Settings size={16} className="text-gray-400" />
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          {pdfUrl && <PDFPanel
            pdfUrl={pdfUrl}
            annotations={annotations}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreateHighlight={handleCreateHighlight}
            onCreateRegion={handleCreateRegion}
            onCreateNote={handleCreateNote}
            onUpdateComment={handleUpdateComment}
            onDelete={handleDelete}
            onAskAbout={handleAskAbout}
            regionText={regionText}
            jumpTarget={jumpTarget}
            flash={flash}
          />}
        </div>

        {sidebarOpen && (
          <div className="w-96 flex-shrink-0 border-l border-gray-200 flex flex-col bg-white">
            <div className="flex border-b border-gray-200 flex-shrink-0">
              <button
                onClick={() => setTab('chat')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                  tab === 'chat' ? 'text-blue-600 border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <MessagesSquare size={14} /> Chat
              </button>
              <button
                onClick={() => setTab('annotations')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                  tab === 'annotations' ? 'text-blue-600 border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <ListChecks size={14} /> Annotations
                {annotations.length > 0 && (
                  <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-1.5">{annotations.length}</span>
                )}
              </button>
            </div>

            {tab === 'chat' ? (
              activeChat && (
                <ChatPanel
                  paperTitle={cache.title || opened.name}
                  chunks={chunks}
                  quote={pendingQuote}
                  onClearQuote={() => setPendingQuote(null)}
                  onJumpToLocation={handleJumpToLocation}
                  focusNonce={chatFocusNonce}
                  chats={chats}
                  activeChatId={activeChat.id}
                  messages={activeChat.messages}
                  onMessagesChange={setActiveMessages}
                  onNewChat={handleNewChat}
                  onSwitchChat={setActiveChatId}
                  onDeleteChat={handleDeleteChat}
                />
              )
            ) : (
              <AnnotationsList
                annotations={annotations}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onJump={handleJumpAnnotation}
                onUpdateComment={handleUpdateComment}
                onDelete={handleDelete}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
