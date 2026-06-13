import { useEffect, useState } from 'react';
import { api, type ChunkResult, type Note, type Passage, type PassageLinkDetail, type Rect, type SearchResponse, type SimilarPassage, type Tag } from '../api';
import { Highlighter, Search, Link2, Link, StickyNote, Tag as TagIcon, Trash2, Plus, X } from 'lucide-react';

type Tab = 'passages' | 'similar' | 'search' | 'notes' | 'links';

interface Props {
  paperId: number;
  projectId: number;
  passages: Passage[];
  selectedPassage: Passage | null;
  onSelectPassage: (passage: Passage) => void;
  onPassageDeleted: (id: number) => void;
  onPassageUpdated: (passage: Passage) => void;
  onSimilarClick?: (s: SimilarPassage, allFromPaper: SimilarPassage[]) => void;
  onOpenLinkedPaper?: (paperId: number, paperTitle: string, page: number, rects: Rect[]) => void;
  onLinkDeleted?: (linkId: number) => void;
  linksVersion?: number;
}

export function ContextPanel({
  paperId, projectId, passages, selectedPassage,
  onSelectPassage, onPassageDeleted, onPassageUpdated, onSimilarClick,
  onOpenLinkedPaper, onLinkDeleted, linksVersion,
}: Props) {
  const [tab, setTab] = useState<Tab>('passages');
  const [tags, setTags] = useState<Tag[]>([]);
  const [similar, setSimilar] = useState<SimilarPassage[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [taggingPassageId, setTaggingPassageId] = useState<number | null>(null);
  const [links, setLinks] = useState<PassageLinkDetail[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);

  useEffect(() => {
    api.listTags(projectId).then(setTags);
  }, [projectId]);

  // Load similar passages when selected passage changes
  useEffect(() => {
    if (!selectedPassage) { setSimilar([]); return; }
    setSimilarLoading(true);
    api.getSimilarPassages(selectedPassage.id, 10, projectId)
      .then(setSimilar)
      .catch(() => setSimilar([]))
      .finally(() => setSimilarLoading(false));
  }, [selectedPassage?.id, projectId]);

  // Load notes when selected passage changes
  useEffect(() => {
    if (!selectedPassage) { setNotes([]); return; }
    api.getPassageNotes(selectedPassage.id).then(setNotes);
  }, [selectedPassage?.id]);

  // Load links when the links tab is active
  useEffect(() => {
    if (tab !== 'links') return;
    setLinksLoading(true);
    api.getPaperLinks(paperId)
      .then(setLinks)
      .catch(() => setLinks([]))
      .finally(() => setLinksLoading(false));
  }, [tab, paperId, passages.length, linksVersion]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const response = await api.searchPaper(paperId, searchQuery);
      setSearchResponse(response);
    } finally {
      setSearching(false);
    }
  };

  const handleAddTag = async (tag: Tag, passage: Passage) => {
    await api.addPassageTag(passage.id, tag.id);
    onPassageUpdated({ ...passage, tags: [...passage.tags, tag] });
  };

  const handleRemoveTag = async (tagId: number, passage: Passage) => {
    await api.removePassageTag(passage.id, tagId);
    onPassageUpdated({ ...passage, tags: passage.tags.filter(t => t.id !== tagId) });
    const stillUsed = passages.some(p => p.id !== passage.id && p.tags.some(t => t.id === tagId));
    if (!stillUsed) setTags(prev => prev.filter(t => t.id !== tagId));
  };

  const handleCreateTag = async (passage?: Passage) => {
    if (!newTagName.trim()) return;
    const tag = await api.createTag(newTagName.trim(), 'content', projectId);
    setTags(prev => [...prev, tag]);
    setNewTagName('');
    setAddingTag(false);
    const target = passage ?? selectedPassage;
    if (target) handleAddTag(tag, target);
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedPassage) return;
    const note = await api.createNote({
      type: 'passage',
      content: newNote.trim(),
      passage_ids: [selectedPassage.id],
    });
    setNotes(prev => [note, ...prev]);
    setNewNote('');
  };

  const handleDeleteNote = async (id: number) => {
    await api.deleteNote(id);
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  const handleDeletePassage = async (id: number) => {
    if (!confirm('Delete this highlight?')) return;
    await api.deletePassage(id);
    onPassageDeleted(id);
  };

  const handleDeleteLink = async (link: PassageLinkDetail) => {
    await api.deletePassageLink(link.local_passage_id, link.remote_passage_id);
    setLinks(prev => prev.filter(l => l.id !== link.id));
    onLinkDeleted?.(link.id);
  };

  const appliedTagIds = new Set(selectedPassage?.tags.map(t => t.id) ?? []);
  const availableTags = tags.filter(t => !appliedTagIds.has(t.id) && t.type === 'content');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'passages', label: 'Highlights', icon: <Highlighter size={14} /> },
    { id: 'links', label: 'Links', icon: <Link size={14} /> },
    { id: 'similar', label: 'Similar', icon: <Link2 size={14} /> },
    { id: 'search', label: 'Search', icon: <Search size={14} /> },
    { id: 'notes', label: 'Notes', icon: <StickyNote size={14} /> },
  ];

  return (
    <div className="relative z-20 flex flex-col h-full bg-white border-l border-gray-200">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 flex-shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 transition-colors flex-1 justify-center ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">

        {/* HIGHLIGHTS TAB */}
        {tab === 'passages' && (
          <div className="space-y-2">
            {passages.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8">No highlights yet. Select text in the PDF to highlight it.</p>
            )}
            {passages.map(passage => {
              const isTagging = taggingPassageId === passage.id;
              const passageTagIds = new Set(passage.tags.map(t => t.id));
              const cardAvailableTags = tags.filter(t => !passageTagIds.has(t.id) && t.type === 'content');
              return (
                <div
                  key={passage.id}
                  onClick={() => onSelectPassage(passage)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all group ${
                    selectedPassage?.id === passage.id
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="w-1 rounded-full flex-shrink-0 mt-0.5 h-full min-h-[2rem]"
                      style={{ backgroundColor: passage.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-700 line-clamp-3">{passage.text}</p>
                      <p className="text-xs text-gray-400 mt-1">Page {passage.page + 1}</p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {passage.tags.map(tag => (
                          <span
                            key={tag.id}
                            onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
                          >
                            {tag.name}
                            <button onClick={e => { e.stopPropagation(); handleRemoveTag(tag.id, passage); }}>
                              <X size={9} className="text-gray-400 hover:text-red-400" />
                            </button>
                          </span>
                        ))}
                        <button
                          onClick={e => { e.stopPropagation(); setTaggingPassageId(isTagging ? null : passage.id); setNewTagName(''); setAddingTag(false); }}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 border border-dashed border-gray-300 rounded text-xs text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
                        >
                          <Plus size={9} /> tag
                        </button>
                      </div>
                      {isTagging && (
                        <div className="mt-2 pt-2 border-t border-gray-100" onClick={e => e.stopPropagation()}>
                          {!addingTag ? (
                            <div className="flex flex-wrap gap-1">
                              {cardAvailableTags.map(tag => (
                                <button
                                  key={tag.id}
                                  onClick={() => { handleAddTag(tag, passage); setTaggingPassageId(null); }}
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
                                onKeyDown={e => { if (e.key === 'Enter') { handleCreateTag(passage); setTaggingPassageId(null); } if (e.key === 'Escape') setAddingTag(false); }}
                                placeholder="Tag name"
                                className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                              <button onClick={() => { handleCreateTag(passage); setTaggingPassageId(null); }} className="px-2 py-1 bg-blue-600 text-white text-xs rounded-lg">Add</button>
                              <button onClick={() => setAddingTag(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={12} /></button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleDeletePassage(passage.id); }}
                      className="p-1 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* LINKS TAB */}
        {tab === 'links' && (
          <div className="space-y-3">
            {linksLoading && (
              <p className="text-xs text-gray-400 text-center py-8 animate-pulse">Loading links…</p>
            )}
            {!linksLoading && links.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8">No manual links yet. Use the link button in a highlight toolbar to connect passages across papers.</p>
            )}
            {!linksLoading && links.map(link => (
              <div key={link.id} className="border border-gray-200 rounded-xl overflow-hidden">
                {/* Local passage */}
                <div className="p-3 bg-gray-50 border-b border-gray-100">
                  <p className="text-xs text-gray-400 mb-1">From · page {link.local_page + 1}</p>
                  <p className="text-xs text-gray-700 line-clamp-2">{link.local_passage_text}</p>
                </div>
                {/* Remote passage */}
                <div className="p-3">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-teal-500 text-xs">→</span>
                    <p className="text-xs font-medium text-teal-700 truncate">{link.remote_paper_title}</p>
                    <span className="text-xs text-gray-400 flex-shrink-0">· p.{link.remote_page + 1}</span>
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-2">{link.remote_passage_text}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => onOpenLinkedPaper?.(link.remote_paper_id, link.remote_paper_title, link.remote_page, link.remote_rects)}
                      className="px-2 py-1 text-xs bg-teal-50 text-teal-700 border border-teal-200 rounded-lg hover:bg-teal-100 transition-colors"
                    >
                      Open paper
                    </button>
                    <button
                      onClick={() => handleDeleteLink(link)}
                      className="ml-auto p-1 text-gray-300 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* SIMILAR TAB */}
        {tab === 'similar' && (
          <div className="space-y-3">
            {!selectedPassage && (
              <p className="text-xs text-gray-400 text-center py-8">Select a highlight to find similar passages.</p>
            )}
            {selectedPassage && (
              <>
                <div className="p-3 bg-yellow-50 rounded-xl border border-yellow-200 mb-4">
                  <p className="text-xs font-medium text-yellow-700 mb-1">Looking for passages similar to:</p>
                  <p className="text-xs text-gray-700 line-clamp-2">{selectedPassage.text}</p>
                </div>
                {similarLoading && (
                  <p className="text-xs text-gray-400 text-center py-4 animate-pulse">Searching…</p>
                )}
                {!similarLoading && similar.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-8">No similar content found in this project.</p>
                )}
                {similar.map(s => (
                  <div
                    key={`${s.source}-${s.passage_id}`}
                    className="p-3 border border-gray-200 rounded-xl hover:border-purple-300 hover:bg-purple-50 transition-colors cursor-pointer"
                    onClick={() => onSimilarClick?.(s, similar.filter(x => x.paper_id === s.paper_id))}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-600 truncate">{s.paper_title}</p>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {s.source === 'passage' ? (
                          <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">highlight</span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">chunk</span>
                        )}
                        <span className="text-xs text-gray-400">{Math.round(s.similarity * 100)}%</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-700 line-clamp-3">{s.text}</p>
                    <p className="text-xs text-gray-400 mt-1">Page {s.page + 1}</p>
                    {s.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {s.tags.map(tag => (
                          <span key={tag.id} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* SEARCH TAB */}
        {tab === 'search' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Ask a question about this paper…"
                className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={handleSearch}
                disabled={searching}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-60"
              >
                {searching ? '…' : 'Go'}
              </button>
            </div>
            {!searching && searchResponse && searchResponse.chunks.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">No results.</p>
            )}
            {searchResponse?.answer && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <p className="text-xs font-medium text-blue-700 mb-1">Answer</p>
                <p className="text-xs text-gray-800 whitespace-pre-wrap">{searchResponse.answer}</p>
              </div>
            )}
            {searchResponse?.chunks.map(r => (
              <div key={r.chunk_id} className="p-3 border border-gray-200 rounded-xl">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400">Page {r.page + 1}</p>
                  <span className="text-xs text-gray-400">{Math.round(r.similarity * 100)}%</span>
                </div>
                <p className="text-xs text-gray-700">{r.text}</p>
              </div>
            ))}
          </div>
        )}

        {/* NOTES TAB */}
        {tab === 'notes' && (
          <div className="space-y-3">
            {!selectedPassage && (
              <p className="text-xs text-gray-400 text-center py-8">Select a highlight to add notes.</p>
            )}
            {selectedPassage && (
              <>
                {/* Tag management */}
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center gap-1 mb-2">
                    <TagIcon size={12} className="text-gray-500" />
                    <p className="text-xs font-medium text-gray-600">Tags</p>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {selectedPassage.tags.map(tag => (
                      <span key={tag.id} className="flex items-center gap-1 px-2 py-0.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600">
                        {tag.name}
                        <button onClick={() => handleRemoveTag(tag.id, selectedPassage)}>
                          <X size={10} className="text-gray-400 hover:text-red-400" />
                        </button>
                      </span>
                    ))}
                  </div>
                  {!addingTag ? (
                    <div className="flex flex-wrap gap-1">
                      {availableTags.slice(0, 6).map(tag => (
                        <button
                          key={tag.id}
                          onClick={() => handleAddTag(tag, selectedPassage)}
                          className="px-2 py-0.5 bg-white border border-dashed border-gray-300 rounded-full text-xs text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors"
                        >
                          + {tag.name}
                        </button>
                      ))}
                      <button
                        onClick={() => setAddingTag(true)}
                        className="px-2 py-0.5 bg-white border border-dashed border-gray-300 rounded-full text-xs text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center gap-1"
                      >
                        <Plus size={10} /> New tag
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-1.5">
                      <input
                        autoFocus
                        value={newTagName}
                        onChange={e => setNewTagName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreateTag(); if (e.key === 'Escape') setAddingTag(false); }}
                        placeholder="Tag name"
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      <button onClick={handleCreateTag} className="px-2 py-1 bg-blue-600 text-white text-xs rounded-lg">Add</button>
                      <button onClick={() => setAddingTag(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={12} /></button>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-2">
                  {notes.map(note => (
                    <div key={note.id} className="p-3 bg-yellow-50 border border-yellow-200 rounded-xl group relative">
                      <p className="text-xs text-gray-700 whitespace-pre-wrap">{note.content}</p>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="absolute top-2 right-2 p-1 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <textarea
                      value={newNote}
                      onChange={e => setNewNote(e.target.value)}
                      placeholder="Add a note…"
                      rows={3}
                      className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                    />
                  </div>
                  <button
                    onClick={handleAddNote}
                    disabled={!newNote.trim()}
                    className="w-full py-1.5 bg-yellow-400 text-yellow-900 text-xs rounded-lg hover:bg-yellow-500 disabled:opacity-40 transition-colors"
                  >
                    Save note
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
