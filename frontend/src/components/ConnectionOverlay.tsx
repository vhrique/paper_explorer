interface Props {
  sourceRect: DOMRect | null;
  targetRects: DOMRect[];
  offscreenRects?: DOMRect[];
}

export function ConnectionOverlay({ sourceRect, targetRects, offscreenRects = [] }: Props) {
  if (!sourceRect || (targetRects.length === 0 && offscreenRects.length === 0)) return null;

  const x1 = sourceRect.right;
  const y1 = sourceRect.top + sourceRect.height / 2;

  const makePath = (x2: number, y2: number) => {
    const dx = (x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  return (
    <svg
      className="fixed inset-0 pointer-events-none"
      style={{ width: '100vw', height: '100vh', zIndex: 200, overflow: 'visible' }}
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
      </defs>

      {/* Off-screen passages: dashed faded lines to panel top/bottom edge */}
      {offscreenRects.map((r, i) => {
        const x2 = r.left;
        const y2 = r.top;
        const d = makePath(x2, y2);
        return (
          <g key={`off-${i}`} opacity="0.35">
            <path d={d} stroke="#8b5cf6" strokeWidth="2" fill="none" strokeDasharray="5 4" />
            <circle cx={x2} cy={y2} r="3" fill="#8b5cf6" />
          </g>
        );
      })}

      {/* Visible passages: solid glowing lines */}
      {targetRects.map((r, i) => {
        const x2 = r.left;
        const y2 = r.top + r.height / 2;
        const d = makePath(x2, y2);
        return (
          <g key={`on-${i}`}>
            <path d={d} stroke="#8b5cf6" strokeWidth="6" fill="none" opacity="0.2" filter="url(#conn-glow)" />
            <path d={d} stroke="url(#conn-grad)" strokeWidth="2.5" fill="none" opacity="0.85" />
            <circle cx={x1} cy={y1} r="4" fill="#7c3aed" opacity="0.8" />
            <circle cx={x2} cy={y2} r="4" fill="#6d28d9" opacity="0.8" />
          </g>
        );
      })}
    </svg>
  );
}
