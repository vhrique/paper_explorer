import { useEffect, useRef, useState } from 'react';
import { Send, Square, MapPin, X, Plus, ChevronLeft, ChevronRight, ChevronDown, Trash2 } from 'lucide-react';
import type { ChatMessage, ChatSession, ChunkResult, QuoteContext } from '../api';
import { answer, type PaperChunks } from '../services/qaService';
import { hasLLMConfig } from '../services/settingsService';

/** Hide the trailing "@@SOURCES: …" marker line from the displayed answer. */
const stripSourcesLine = (t: string) => t.replace(/\n*\s*@@SOURCES:?.*$/is, '').trimEnd();

const fmtK = (n?: number) => (n == null ? '?' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

interface Props {
  paperTitle: string;
  chunks: PaperChunks;
  quote: QuoteContext | null;
  onClearQuote: () => void;
  onJumpToLocation: (loc: ChunkResult) => void;
  focusNonce: number;

  chats: ChatSession[];
  activeChatId: string;
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  onNewChat: () => void;
  onSwitchChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
}

export function ChatPanel({
  paperTitle, chunks, quote, onClearQuote, onJumpToLocation, focusNonce,
  chats, activeChatId, messages, onMessagesChange, onNewChat, onSwitchChat, onDeleteChat,
}: Props) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [focusNonce]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Switching chats resets the input and cancels any in-flight request.
  useEffect(() => {
    setInput('');
    setMenuOpen(false);
    abortRef.current?.abort();
  }, [activeChatId]);

  const llmReady = hasLLMConfig();
  const idx = Math.max(0, chats.findIndex(c => c.id === activeChatId));

  const cycle = (delta: number) => {
    if (chats.length < 2) return;
    onSwitchChat(chats[(idx + delta + chats.length) % chats.length].id);
  };

  const send = async () => {
    const question = input.trim();
    if (!question || busy) return;
    setInput('');

    const pinned = quote;
    onClearQuote();

    const history = messages.map(m => ({ role: m.role, content: m.content }));
    const withPending: ChatMessage[] = [
      ...messages,
      { role: 'user', content: question, quote: pinned },
      { role: 'assistant', content: '' },
    ];
    onMessagesChange(withPending);

    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await answer({ question, paperTitle, chunks, history, quote: pinned, signal: ctrl.signal });
      onMessagesChange([
        ...withPending.slice(0, -1),
        {
          role: 'assistant',
          content: (res.answer && res.answer.trim()) || (llmReady ? '(no answer returned)' : ''),
          locations: res.locations,
          cited: res.cited,
          citedNote: res.citedNote,
          passagesSent: res.passagesSent,
          passagesTotal: res.passagesTotal,
          mode: res.mode,
          paperTokens: res.paperTokens,
          contextTokens: res.contextTokens,
        },
      ]);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        onMessagesChange([...withPending.slice(0, -1), { role: 'assistant', content: `Error: ${(e as Error).message}` }]);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Chat switcher */}
      <div className="relative flex items-center gap-1 px-2 py-1.5 border-b border-gray-100 flex-shrink-0">
        <button
          onClick={() => cycle(-1)}
          disabled={busy || chats.length < 2}
          className="p-1 text-gray-400 hover:text-gray-700 rounded disabled:opacity-30"
          title="Previous chat"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => setMenuOpen(o => !o)}
          className="flex-1 min-w-0 flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded"
        >
          <span className="truncate">{chats[idx]?.title || 'New chat'}</span>
          <span className="text-gray-300 flex-shrink-0">{idx + 1}/{chats.length}</span>
          <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
        </button>
        <button
          onClick={() => cycle(1)}
          disabled={busy || chats.length < 2}
          className="p-1 text-gray-400 hover:text-gray-700 rounded disabled:opacity-30"
          title="Next chat"
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={onNewChat}
          disabled={busy}
          className="p-1 text-gray-400 hover:text-blue-600 rounded disabled:opacity-30"
          title="New chat"
        >
          <Plus size={15} />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div className="absolute top-full left-2 right-2 z-40 mt-1 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg py-1">
              {chats.map(c => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1 px-2 py-1.5 text-xs hover:bg-blue-50 ${
                    c.id === activeChatId ? 'text-blue-600 font-medium' : 'text-gray-600'
                  }`}
                >
                  <button
                    onClick={() => { onSwitchChat(c.id); setMenuOpen(false); }}
                    className="flex-1 min-w-0 text-left truncate"
                  >
                    {c.title || 'New chat'}
                  </button>
                  <button
                    onClick={() => onDeleteChat(c.id)}
                    className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                    title="Delete chat"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {!llmReady && (
        <div className="m-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800">
          No LLM endpoint configured, so there are no written answers yet — only paragraph locations.
          Add one in <span className="font-semibold">Settings</span> (LM Studio, Ollama, OpenAI, …).
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center px-4 pt-6">
            Ask a question about this paper. Answers cite the paragraphs they come from — click a
            location to jump there.
          </p>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            {m.role === 'user' && m.quote?.text && (
              <div className="inline-block max-w-full text-left mb-1 px-2 py-1 bg-gray-100 rounded-lg text-[11px] text-gray-500 truncate">
                {m.quote.kind === 'region' ? 'p.' + (m.quote.page + 1) + ' region · ' : ''}
                "{m.quote.text.slice(0, 80)}{m.quote.text.length > 80 ? '…' : ''}"
              </div>
            )}
            {(m.content || (busy && i === messages.length - 1)) && (
              <div
                className={`inline-block max-w-full text-left px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
                }`}
              >
                {(m.role === 'assistant' ? stripSourcesLine(m.content) : m.content) ||
                  (busy && i === messages.length - 1 ? 'Reading the paper…' : '…')}
              </div>
            )}

            {m.role === 'assistant' && m.mode === 'window' && (
              <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                Whole paper ≈ {fmtK(m.paperTokens)} tokens, context window {fmtK(m.contextTokens)} — sent the
                {' '}{m.passagesSent} most relevant of {m.passagesTotal} passages. Raise the window in Settings
                (or use a bigger-context model) to send all of it.
              </p>
            )}

            {m.role === 'assistant' && m.mode === 'region' && (
              <p className="mt-1.5 text-[11px] text-gray-500">
                Answered about your selection — sent {m.passagesSent} passages around it, not the whole paper.
              </p>
            )}

            {m.role === 'assistant' && m.citedNote && (!m.locations || m.locations.length === 0) && (
              <p className="mt-1.5 text-[11px] text-gray-400">{m.citedNote}</p>
            )}

            {m.role === 'assistant' && m.locations && m.locations.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                  {m.cited ? 'Sources cited by the model' : 'Keyword matches'}
                  {m.mode ? (
                    <span className="normal-case font-normal">
                      {' '}· sent{' '}
                      {m.mode === 'full'
                        ? `all ${m.passagesSent}`
                        : m.mode === 'region'
                          ? `${m.passagesSent} around the selection`
                          : `${m.passagesSent}/${m.passagesTotal}`}{' '}
                      passages{m.mode !== 'region' && m.paperTokens ? `, ~${fmtK(m.paperTokens)} tok` : ''}
                    </span>
                  ) : null}
                </p>
                {m.citedNote && <p className="text-[11px] text-gray-400 -mt-0.5">{m.citedNote}</p>}
                {m.locations.map((loc, li) => (
                  <button
                    key={loc.chunk_id}
                    onClick={() => onJumpToLocation(loc)}
                    className="w-full text-left px-2.5 py-1.5 border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-colors"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] text-purple-600 font-medium">
                      <MapPin size={11} /> Page {loc.page + 1}
                      {m.cited ? (
                        <span className="text-gray-400">· #{li + 1}</span>
                      ) : (
                        <><span className="text-gray-300">·</span><span className="text-gray-400">{Math.round(loc.similarity * 100)}%</span></>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 line-clamp-4 mt-0.5">{loc.text}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 p-2.5 space-y-2">
        {quote?.text && (
          <div className="flex items-start gap-1.5 px-2 py-1.5 bg-purple-50 border border-purple-100 rounded-lg">
            <MapPin size={12} className="text-purple-500 mt-0.5 flex-shrink-0" />
            <p className="flex-1 text-[11px] text-purple-700 line-clamp-2">
              {quote.kind === 'region' ? `p.${quote.page + 1} region · ` : ''}
              {quote.text.slice(0, 140) || '(no text found in region)'}
            </p>
            <button onClick={onClearQuote} className="text-purple-400 hover:text-purple-600 flex-shrink-0">
              <X size={12} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Ask about this paper…"
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none max-h-32"
          />
          {busy ? (
            <button onClick={stop} className="p-2 bg-gray-200 text-gray-600 rounded-xl hover:bg-gray-300" title="Stop">
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40"
              title="Send"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
