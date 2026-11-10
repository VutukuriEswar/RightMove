import React, { useMemo } from 'react';

const W = 100;
const H = 40;

export default function EvalChart({ graph = [], currentPly = null, onSelectPly }) {
  const points = useMemo(() => {
    if (!Array.isArray(graph) || graph.length < 2) return null;
    return graph.map((entry, index) => {
      const win = Math.max(0, Math.min(100, Number(entry.win_white ?? 50)));
      return {
        x: (index / (graph.length - 1)) * W,
        y: H - (win / 100) * H,
        win,
        ply: entry.ply ?? index,
      };
    });
  }, [graph]);

  if (!points) {
    return <p className="ev-empty-note">The evaluation graph appears once Stockfish finishes this game.</p>;
  }

  const line = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const area = `${line} ${W},${H} 0,${H}`;
  const current = currentPly != null && currentPly >= 0
    ? points.find((p) => p.ply === currentPly + 1) || points[Math.min(currentPly, points.length - 1)]
    : null;

  const handleClick = (event) => {
    if (!onSelectPly) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (points.length - 1));
    const target = points[idx];
    if (target) onSelectPly(Math.max(0, (target.ply || 1) - 1));
  };

  return (
    <div className="ev-eval-chart" onClick={handleClick} role="img" aria-label="Stockfish evaluation graph">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="evEvalFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(245, 240, 225, 0.85)" />
            <stop offset="50%" stopColor="rgba(245, 240, 225, 0.25)" />
            <stop offset="100%" stopColor="rgba(28, 16, 8, 0.9)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="rgba(28, 16, 8, 0.55)" />
        <rect x="0" y="0" width={W} height={H / 2} fill="rgba(245, 240, 225, 0.14)" />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(212, 175, 55, 0.5)" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
        <polygon points={area} fill="url(#evEvalFill)" opacity="0.5" />
        <polyline points={line} fill="none" stroke="#D4AF37" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
        {current && (
          <line x1={current.x} y1="0" x2={current.x} y2={H} stroke="rgba(139, 37, 0, 0.9)" strokeWidth="0.6" />
        )}
      </svg>
      <div className="ev-eval-labels">
        <span>White advantage</span>
        <span>Black advantage</span>
      </div>
    </div>
  );
}
