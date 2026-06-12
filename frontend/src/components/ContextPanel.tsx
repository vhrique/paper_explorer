import { useEffect, useState } from 'react';
import { api, type ChunkResult, type Note, type Passage, type SimilarPassage, type Tag } from '../api';
import { Highlighter, Search, Link2, StickyNote, Tag as TagIcon, Trash2, Plus, X } from 'lucide-react';

type Tab = 'passages' | 'similar' | 'search' | 'notes';

interface Props {
  paperId: number;
  projectId: number;
  passages: Passage[];
  selectedPassage: Passage | null;
  onSelectPassage: (passage: Passage) => void;
  onPassageDeleted: (id: number) => void;
  onPassageUpdated: (passage: Passage) => void;
}

export function ContextPanel({
  paperId, projectId, passages, selectedPassage,
  onSelectPassage, onPassageDeleted, onPassageUpdated,
}: Props) {
  const [tab, setTab] = useState<Tab>('passages');
  const [tags, setTags] = useState<Tag[]>([]);
  const [similar, setSimilar] = useState<SimilarPassage[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChunkResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [addingTag, setAddingTag] = useState(false);

  useEffect(() => {
    api.listTags(projectId).then(setTags);
  }, [projectId]);

  // Load similar passages when selected passage changes
  useEffect(() => {
    if (!selectedPassage) { setSimilar([]); return; }
    setSimilarLoading(true);
    api.getSimilarPassages(selectedPassage.id)
      .then(setSimilar)
      .catch(() => setSimilar([]))
      .finally(() => setSimilarLoading(false));
  }, [selectedPassage?.id]);

  // Load notes when selected passage changes
  useEffect(() => {
    if (!selectedPassage) { setNotes([]); return; }
    api.getPassageNotes(selectedPassage.id).then(setNotes);
  }, [selectedPassage?.id]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await api.searchPaper(paperId, searchQuery);
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  };

  const handleAddTag = async (tag: Tag) => {
    if (!selectedPassage) return;
    await api.addPassageTag(selectedPassage.id, tag.id);
    onPassageUpdated({ ...selectedPassage, tags: [...selectedPassage.tags, tag] });
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!selectedPassage) return;
    await api.removePassageTag(selectedPassage.id, tagId);
    onPassageUpdated({ ...selectedPassage, tags: selectedPassage.tags.filter(t => t.id !== tagId) });
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    const tag = await api.createTag(newTagName.trim(), 'content', projectId);
    setTags(prev => [...prev, tag]);
    setNewTagName('');
    setAddingTag(false);
    if (selectedPassage) handleAddTag(tag);
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

  const appliedTagIds = new Set(selectedPassage?.tags.map(t => t.id) ?? []);
  const availableTags = tags.filter(t => !appliedTagIds.has(t.id) && t.type === 'content');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'passages', label: 'Highlights', icon: <Highlighter size={14} /> },
    { id: 'similar', label: 'Similar', icon: <Link2 size={14} /> },
    { id: 'search', label: 'Search', icon: <Search size={14} /> },
    { id: 'notes', label: 'Notes', icon: <StickyNote size={14} /> },
  ];

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
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
            {passages.map(passage => (
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
                    {passage.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {passage.tags.map(tag => (
                          <span key={tag.id} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                            {tag.name}
                          </span>
                        ))}
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
                  <p className="text-xs text-gray-400 text-center py-8">No similar passages found in this project.</p>
                )}
                {similar.map(s => (
                  <div key={s.passage_id} className="p-3 border border-gray-200 rounded-xl hover:border-blue-200 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-600 truncate">{s.paper_title}</p>
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{Math.round(s.similarity * 100)}%</span>
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
            {searchResults.length === 0 && !searching && searchQuery && (
              <p className="text-xs text-gray-400 text-center py-4">No results.</p>
            )}
            {searchResults.map(r => (
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
                        <button onClick={() => handleRemoveTag(tag.id)}>
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
                          onClick={() => handleAddTag(tag)}
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
