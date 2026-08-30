import { useState } from 'react';
import { Highlighter, SquareDashed, StickyNote, Trash2, Pencil, Check, X } from 'lucide-react';
import type { Annotation } from '../api';

interface Props {
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onJump: (a: Annotation) => void;
  onUpdateComment: (id: string, comment: string) => void;
  onDelete: (id: string) => void;
}

const KIND_ICON = {
  highlight: Highlighter,
  region: SquareDashed,
  note: StickyNote,
} as const;

export function AnnotationsList({ annotations, selectedId, onSelect, onJump, onUpdateComment, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const sorted = [...annotations].sort(
    (a, b) => a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0),
  );

  if (!sorted.length) {
    return (
      <p className="text-xs text-gray-400 text-center px-4 pt-8">
        No annotations yet. Select text to highlight, drag a region, or drop a note — all saved into
        the PDF file itself.
      </p>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
      {sorted.map(a => {
        const Icon = KIND_ICON[a.kind];
        const editing = editingId === a.id;
        return (
          <div
            key={a.id}
            className={`border rounded-xl p-2.5 transition-colors ${
              selectedId === a.id ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: a.color }}>
                <Icon size={10} className="text-gray-800" />
              </span>
              <button onClick={() => { onSelect(a.id); onJump(a); }} className="text-[11px] text-gray-500 hover:text-blue-600 font-medium">
                Page {a.page + 1}
              </button>
              <div className="flex-1" />
              <button
                onClick={() => { setEditingId(a.id); setDraft(a.comment); }}
                className="p-1 text-gray-400 hover:text-amber-600 rounded"
                title="Edit comment"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => { if (confirm('Delete this annotation from the PDF?')) onDelete(a.id); }}
                className="p-1 text-gray-400 hover:text-red-500 rounded"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            </div>

            {a.text && !editing && (
              <p className="mt-1.5 text-[11px] text-gray-500 line-clamp-2 italic">"{a.text}"</p>
            )}

            {editing ? (
              <div className="mt-2 flex items-start gap-1.5">
                <textarea
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={2}
                  placeholder="Comment…"
                  className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                />
                <button
                  onClick={() => { onUpdateComment(a.id, draft.trim()); setEditingId(null); }}
                  className="p-1 text-green-600 hover:bg-green-50 rounded"
                >
                  <Check size={13} />
                </button>
                <button onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                  <X size={13} />
                </button>
              </div>
            ) : (
              a.comment && (
                <p className="mt-1.5 text-xs text-gray-700 bg-amber-50 rounded-lg px-2 py-1.5 whitespace-pre-wrap">
                  {a.comment}
                </p>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
