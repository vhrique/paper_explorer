interface SideRect { passageId: number; rect: DOMRect }

interface Props {
  // Always pass left-panel rects as leftSideRects, right-panel rects as rightSideRects.
  // Lines always draw from leftSide.right → rightSide.left, regardless of which is the "source".
  leftSideRects: SideRect[];
  rightSideRects: SideRect[];
  // Manual links
  linkRects?: { source: DOMRect; target: DOMRect; sourceId: number; targetId: number }[];
  // Rubber-band during linking
  linkingSource?: DOMRect | null;
  linkingMouse?: { x: number; y: number } | null;
  // Hover tracking
  hoveredPassageId: number | null;
  selectedPassageId?: number;
}

export function ConnectionOverlay({
  leftSideRects,
  rightSideRects,
  linkRects = [],
  linkingSource,
  linkingMouse,
  hoveredPassageId,
  selectedPassageId,
}: Props) {
  // Build similarity lines: always left.right → right.left
  const simLines: { x1: number; y1: number; x2: number; y2: number; pid1: number; pid2: number }[] = [];

  if (leftSideRects.length > 0 && rightSideRects.length > 0) {
    if (leftSideRects.length === 1) {
      const src = leftSideRects[0];
      for (const tgt of rightSideRects) {
        simLines.push({
          x1: src.rect.right,  y1: src.rect.top + src.rect.height / 2,
          x2: tgt.rect.left,   y2: tgt.rect.top + tgt.rect.height / 2,
          pid1: src.passageId, pid2: tgt.passageId,
        });
      }
    } else {
      const tgt = rightSideRects[0];
      for (const src of leftSideRects) {
        simLines.push({
          x1: src.rect.right,  y1: src.rect.top + src.rect.height / 2,
          x2: tgt.rect.left,   y2: tgt.rect.top + tgt.rect.height / 2,
          pid1: src.passageId, pid2: tgt.passageId,
        });
      }
    }
  }

  const hasContent = simLines.length > 0 || linkRects.length > 0 || (linkingSource && linkingMouse);
  if (!hasContent) return null;

  const makePath = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = (x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  return (
    <svg
      className="fixed inset-0 pointer-events-none"
      style={{ width: '100vw', height: '100vh', zIndex: 10, overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="conn-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
        <filter id="conn-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="link-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#0f766e" />
        </linearGradient>
        <filter id="link-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Similarity lines — left.right → right.left */}
      {simLines.map((ln, i) => {
        const isHovered = hoveredPassageId === ln.pid1 || hoveredPassageId === ln.pid2 ||
                          hoveredPassageId === selectedPassageId;
        const opacity = hoveredPassageId !== null ? (isHovered ? 0.9 : 0.05) : 0.25;
        const d = makePath(ln.x1, ln.y1, ln.x2, ln.y2);
        return (
          <g key={`sim-${i}`} opacity={opacity} className="transition-opacity duration-200">
            <path d={d} stroke="#8b5cf6" strokeWidth="6" fill="none" opacity="0.2" filter="url(#conn-glow)" />
            <path d={d} stroke="url(#conn-grad)" strokeWidth="2.5" fill="none" opacity="0.85" />
            <circle cx={ln.x1} cy={ln.y1} r="4" fill="#7c3aed" opacity="0.8" />
            <circle cx={ln.x2} cy={ln.y2} r="4" fill="#6d28d9" opacity="0.8" />
          </g>
        );
      })}

      {/* Manual link lines — teal, always source.right → target.left */}
      {linkRects.map((lr, i) => {
        const x1 = lr.source.right;
        const y1 = lr.source.top + lr.source.height / 2;
        const x2 = lr.target.left;
        const y2 = lr.target.top + lr.target.height / 2;
        const isHovered = hoveredPassageId === lr.sourceId || hoveredPassageId === lr.targetId;
        const opacity = hoveredPassageId !== null ? (isHovered ? 0.9 : 0.05) : 0.25;
        const d = makePath(x1, y1, x2, y2);
        return (
          <g key={`link-${i}`} opacity={opacity} className="transition-opacity duration-200">
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
