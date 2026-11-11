import React, { useMemo, useState } from 'react';

const W = 100;
const H = 50;

export default function WinPercentageChart({
  graph = [],
  currentPly = -1,
  onSelectPly,
  whiteName = 'White',
  blackName = 'Black',
}) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const points = useMemo(() => {
    if (!Array.isArray(graph) || graph.length === 0) return [];
    const len = graph.length;
    return graph.map((entry, idx) => {
      const x = len <= 1 ? W / 2 : (idx / (len - 1)) * W;
      const winW = Math.max(0, Math.min(100, Number(entry.winWhite ?? 50)));
      const y = H - (winW / 100) * H;
      return {
        x,
        y,
        winWhite: winW,
        winBlack: 100 - winW,
        ply: entry.ply ?? idx,
        moveNumber: entry.moveNumber || (Math.floor(idx / 2) + 1),
        san: entry.san || '',
        evalCp: entry.evalCp || 0,
      };
    });
  }, [graph]);

  const activeIndex = useMemo(() => {
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < points.length) {
      return hoverIndex;
    }
    if (currentPly != null && currentPly >= 0) {
      const foundIdx = points.findIndex((p) => p.ply === currentPly);
      if (foundIdx !== -1) return foundIdx;
      return Math.min(currentPly, points.length - 1);
    }
    return points.length > 0 ? points.length - 1 : 0;
  }, [hoverIndex, currentPly, points]);

  const activePoint = points[activeIndex] || null;

  const linePath = useMemo(() => {
    if (points.length < 2) return '';
    return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  }, [points]);

  const areaWhite = useMemo(() => {
    if (points.length < 2) return '';
    return `${linePath} ${W},${H / 2} 0,${H / 2}`;
  }, [linePath, points]);

  const handleClick = (e) => {
    if (!onSelectPly || points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (points.length - 1));
    const target = points[idx];
    if (target) onSelectPly(target.ply);
  };

  const handleMouseMove = (e) => {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (points.length - 1));
    setHoverIndex(idx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  if (points.length === 0) {
    return (
      <div className="ev-win-chart-wrap">
        <p className="ev-empty-note">Waiting for game moves to plot win percentage…</p>
      </div>
    );
  }

  const evalText = activePoint && activePoint.evalCp != null
    ? (activePoint.evalCp >= 0 ? `+${(activePoint.evalCp / 100).toFixed(1)}` : `${(activePoint.evalCp / 100).toFixed(1)}`)
    : '0.0';

  const cleanSan = activePoint?.san && !/^p\d+$/i.test(activePoint.san) && activePoint.san !== 'Start'
    ? activePoint.san
    : '';

  const totalMoves = points.length > 0 ? points[points.length - 1].moveNumber : 0;
  const isLatestPoint = activePoint?.ply === points[points.length - 1]?.ply;

  return (
    <div className="ev-win-chart-container">
      <div className="ev-win-chart-header">
        <div className="ev-win-players-row">
          <div className="ev-win-stat white-stat">
            <span className="ev-win-tag" title={whiteName}>♔ {whiteName}</span>
            <span className="ev-win-val mono">{activePoint ? `${activePoint.winWhite}%` : '50%'}</span>
          </div>
          <div className="ev-win-stat black-stat">
            <span className="ev-win-tag" title={blackName}>♚ {blackName}</span>
            <span className="ev-win-val mono">{activePoint ? `${activePoint.winBlack}%` : '50%'}</span>
          </div>
        </div>

        <div className="ev-win-move-row">
          {activePoint && activePoint.ply > 0 ? (
            <span className="ev-win-move-pill">
              Move {activePoint.moveNumber}{cleanSan ? ` (${cleanSan})` : ''} · Eval: {evalText}
            </span>
          ) : (
            <span className="ev-win-move-pill">Starting Position · Even (50% / 50%)</span>
          )}
        </div>
      </div>

      <div
        className="ev-win-svg-wrap"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        role="img"
        aria-label="Win percentage graph"
      >
        <div className="ev-win-y-axis" aria-hidden="true">
          <span className="ev-win-y-label top">100% ♔</span>
          <span className="ev-win-y-label mid">50%</span>
          <span className="ev-win-y-label bot">100% ♚</span>
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="ev-win-svg">
          <defs>
            <linearGradient id="evWhiteGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(212, 175, 55, 0.45)" />
              <stop offset="100%" stopColor="rgba(212, 175, 55, 0.05)" />
            </linearGradient>
            <linearGradient id="evBlackGrad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="rgba(192, 57, 43, 0.45)" />
              <stop offset="100%" stopColor="rgba(192, 57, 43, 0.05)" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={W} height={H} fill="rgba(14, 9, 4, 0.95)" />
          <rect x="0" y="0" width={W} height={H / 2} fill="rgba(212, 175, 55, 0.06)" />
          <rect x="0" y={H / 2} width={W} height={H / 2} fill="rgba(192, 57, 43, 0.06)" />

          <line
            x1="0"
            y1={H / 2}
            x2={W}
            y2={H / 2}
            stroke="rgba(212, 175, 55, 0.35)"
            strokeWidth="0.4"
            strokeDasharray="1.5 1.5"
          />

          {areaWhite && <polygon points={areaWhite} fill="url(#evWhiteGrad)" />}

          {linePath && (
            <polyline
              points={linePath}
              fill="none"
              stroke="#D4AF37"
              strokeWidth="0.85"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {activePoint && (
            <g>
              <line
                x1={activePoint.x}
                y1="0"
                x2={activePoint.x}
                y2={H}
                stroke="#D4AF37"
                strokeWidth="0.6"
                strokeDasharray="1 1"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="1.4"
                fill="#FFF"
                stroke="#D4AF37"
                strokeWidth="0.6"
              />
            </g>
          )}
        </svg>

        <div className="ev-win-axis-labels">
          <span>Start</span>
          {totalMoves > 6 && <span>Move {Math.floor(totalMoves / 2)}</span>}
          <span>Move {totalMoves > 0 ? totalMoves : 1}{isLatestPoint ? ' · Live' : ''}</span>
        </div>
      </div>
    </div>
  );
}
