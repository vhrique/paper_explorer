interface Props {
  sourceRect: DOMRect | null;
  targetRects: DOMRect[];
  offscreenRects?: DOMRect[];
  // Manual links
  linkRects?: { source: DOMRect; target: DOMRect }[];
  // Rubber-band during linking
  linkingSource?: DOMRect | null;
  linkingMouse?: { x: number; y: number } | null;
}

export function ConnectionOverlay({ sourceRect, targetRects, offscreenRects = [], linkRects = [], linkingSource, linkingMouse }: Props) {
  const hasContent =
    (sourceRect && (targetRects.length > 0 || offscreenRects.length > 0)) ||
    linkRects.length > 0 ||
    (linkingSource && linkingMouse);

  if (!hasContent) return null;

  const makePath = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = (x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  const sx = sourceRect ? sourceRect.right : 0;
  const sy = sourceRect ? sourceRect.top + sourceRect.height / 2 : 0;

  return (
    <svg
      className="fixed inset-0 pointer-events-none"
      style={{ width: '100vw', height: '100vh', zIndex: 200, overflow: 'visible' }}
    >
      <defs>
        {/* Similarity gradient — purple */}
        <linearGradient id="conn-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
        <filter id="conn-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Link gradient — teal */}
        <linearGradient id="link-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#0f766e" />
        </linearGradient>
        <filter id="link-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Similarity: off-screen passages — dashed faded */}
      {sourceRect && offscreenRects.map((r, i) => {
        const d = makePath(sx, sy, r.left, r.top);
        return (
          <g key={`off-${i}`} opacity="0.35">
            <path d={d} stroke="#8b5cf6" strokeWidth="2" fill="none" strokeDasharray="5 4" />
            <circle cx={r.left} cy={r.top} r="3" fill="#8b5cf6" />
          </g>
        );
      })}

      {/* Similarity: visible passages — solid glowing */}
      {sourceRect && targetRects.map((r, i) => {
        const x2 = r.left;
        const y2 = r.top + r.height / 2;
        const d = makePath(sx, sy, x2, y2);
        return (
          <g key={`on-${i}`}>
            <path d={d} stroke="#8b5cf6" strokeWidth="6" fill="none" opacity="0.2" filter="url(#conn-glow)" />
            <path d={d} stroke="url(#conn-grad)" strokeWidth="2.5" fill="none" opacity="0.85" />
            <circle cx={sx} cy={sy} r="4" fill="#7c3aed" opacity="0.8" />
            <circle cx={x2} cy={y2} r="4" fill="#6d28d9" opacity="0.8" />
          </g>
        );
      })}

      {/* Persistent manual link lines — teal */}
      {linkRects.map((lr, i) => {
        const x1 = lr.source.right;
        const y1 = lr.source.top + lr.source.height / 2;
        const x2 = lr.target.left;
        const y2 = lr.target.top + lr.target.height / 2;
        const d = makePath(x1, y1, x2, y2);
        return (
          <g key={`link-${i}`}>
            <path d={d} stroke="#0d9488" strokeWidth="6" fill="none" opacity="0.15" filter="url(#link-glow)" />
            <path d={d} stroke="url(#link-grad)" strokeWidth="2" fill="none" opacity="0.9" />
            <circle cx={x1} cy={y1} r="4" fill="#0d9488" opacity="0.8" />
            <circle cx={x2} cy={y2} r="4" fill="#0f766e" opacity="0.8" />
          </g>
        );
      })}

      {/* Rubber-band line during linking */}
      {linkingSource && linkingMouse && (() => {
        const x1 = linkingSource.right;
        const y1 = linkingSource.top + linkingSource.height / 2;
        const d = makePath(x1, y1, linkingMouse.x, linkingMouse.y);
        return (
          <g>
            <path d={d} stroke="#0d9488" strokeWidth="2" fill="none" opacity="0.7" strokeDasharray="6 4" />
            <circle cx={x1} cy={y1} r="5" fill="#0d9488" opacity="0.6" />
            <circle cx={linkingMouse.x} cy={linkingMouse.y} r="4" fill="#0d9488" opacity="0.5" />
          </g>
        );
      })()}
    </svg>
  );
}
