import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { Chess } from 'chess.js';
import Board2D from '../board/Board2D';
import { useBoardThemeStore } from '../../store/boardThemeStore';

const Board3D = lazy(() => import('../board/Board3D'));

// Helper to resolve move string to chess.js move details
function resolveMove(fen, moveStr) {
  if (!fen || !moveStr) return null;
  try {
    const g = new Chess(fen);
    let m = null;
    try {
      m = g.move(moveStr);
    } catch (_) {}

    if (!m && moveStr.length >= 4) {
      const from = moveStr.slice(0, 2);
      const to = moveStr.slice(2, 4);
      const promotion = moveStr.slice(4) || 'q';
      try {
        m = g.move({ from, to, promotion });
      } catch (_) {}
    }

    if (m) {
      return {
        from: m.from,
        to: m.to,
        san: m.san,
        fenAfter: m.after,
      };
    }
  } catch (_) {}
  return null;
}

export default function DrillBoard({
  fen,
  onMove,
  disabled = false,
  attemptState = null,
  timeTaken = 0,
}) {
  const { style: boardStyle, setStyle } = useBoardThemeStore();

  const [game, setGame] = useState(() => {
    try {
      return new Chess(fen);
    } catch (_) {
      return new Chess();
    }
  });

  const [lastMove, setLastMove] = useState(null);
  const [displayMode, setDisplayMode] = useState('play'); // 'play' | 'compare' | 'best' | 'played'

  useEffect(() => {
    try {
      const nextGame = new Chess(fen);
      setGame(nextGame);
      setLastMove(null);
      setDisplayMode('play');
    } catch (_) {
      setGame(new Chess());
      setLastMove(null);
      setDisplayMode('play');
    }
  }, [fen]);

  // When attempt fails, default to compare view to visualize both moves
  useEffect(() => {
    if (attemptState && !attemptState.isCorrect) {
      setDisplayMode('compare');
    } else {
      setDisplayMode('play');
    }
  }, [attemptState]);

  const bestDetails = useMemo(() => {
    if (!attemptState || !attemptState.bestMove) return null;
    return resolveMove(fen, attemptState.bestMove);
  }, [fen, attemptState]);

  const playedDetails = useMemo(() => {
    if (!attemptState || !attemptState.movePlayed) return null;
    return resolveMove(fen, attemptState.movePlayed);
  }, [fen, attemptState]);

  // Determine active FEN based on displayMode
  const activeFen = useMemo(() => {
    if (!attemptState || attemptState.isCorrect || displayMode === 'play') {
      return game.fen();
    }
    if (displayMode === 'best' && bestDetails?.fenAfter) {
      return bestDetails.fenAfter;
    }
    if (displayMode === 'played' && playedDetails?.fenAfter) {
      return playedDetails.fenAfter;
    }
    return fen; // 'compare' shows original position with overlaid arrows
  }, [displayMode, attemptState, game, bestDetails, playedDetails, fen]);

  // Active arrows to render visually on the board
  const arrows = useMemo(() => {
    if (!attemptState) return null;

    if (attemptState.isCorrect) {
      if (bestDetails) {
        return [{ from: bestDetails.from, to: bestDetails.to, color: '#10b981' }];
      }
      return null;
    }

    // When incorrect:
    if (displayMode === 'best' && bestDetails) {
      return [{ from: bestDetails.from, to: bestDetails.to, color: '#10b981' }];
    }
    if (displayMode === 'played' && playedDetails) {
      return [{ from: playedDetails.from, to: playedDetails.to, color: '#ef4444' }];
    }
    if (displayMode === 'compare') {
      const list = [];
      if (bestDetails) list.push({ from: bestDetails.from, to: bestDetails.to, color: '#10b981' });
      if (playedDetails) list.push({ from: playedDetails.from, to: playedDetails.to, color: '#ef4444' });
      return list.length > 0 ? list : null;
    }
    return null;
  }, [attemptState, displayMode, bestDetails, playedDetails]);

  const highlightSquares = useMemo(() => {
    if (!attemptState) return [];
    if (attemptState.isCorrect) {
      return bestDetails ? [bestDetails.from, bestDetails.to] : [];
    }
    if (displayMode === 'best' && bestDetails) return [bestDetails.from, bestDetails.to];
    if (displayMode === 'played' && playedDetails) return [playedDetails.from, playedDetails.to];
    const list = [];
    if (bestDetails) list.push(bestDetails.from, bestDetails.to);
    if (playedDetails) list.push(playedDetails.from, playedDetails.to);
    return list;
  }, [attemptState, displayMode, bestDetails, playedDetails]);

  const turn = (new Chess(fen)).turn() === 'w' ? 'white' : 'black';
  const turnLabel = turn === 'white' ? 'White to move' : 'Black to move';

  const handleBoardMove = useCallback(
    (uci) => {
      if (disabled || (attemptState !== null && !attemptState.isCorrect)) return;

      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.slice(4) || 'q';

      let move = null;
      try {
        const testGame = new Chess(game.fen());
        move = testGame.move({ from, to, promotion });
      } catch (_) {
        return;
      }

      if (!move) return;

      const nextFen = move.after || game.fen();
      setGame(new Chess(nextFen));
      setLastMove({ from, to });

      if (onMove) {
        onMove(move.san, uci);
      }
    },
    [disabled, attemptState, game, onMove]
  );

  const formatTimer = (secs) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
  };

  const boardBorderColor = attemptState
    ? attemptState.isCorrect
      ? '#10b981'
      : '#ef4444'
    : 'var(--royal-border, rgba(212, 175, 55, 0.35))';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: 540,
        margin: '0 auto',
      }}
    >
      {/* Top Header Card */}
      <div className="drill-header-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              borderRadius: '50%',
              backgroundColor: turn === 'white' ? '#fff' : '#1e1b18',
              border: '2px solid var(--royal-border, #D4AF37)',
              boxShadow: '0 0 6px rgba(0, 0, 0, 0.3)',
            }}
          />
          <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--royal-ink, #1C1008)' }}>
            {turnLabel} · <span style={{ fontWeight: 500, opacity: 0.85 }}>Find the best move</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* 2D / 3D Mode Toggle */}
          <div className="drill-view-toggle" title="Switch Board View (2D / 3D)">
            <button
              type="button"
              className={`drill-view-btn ${boardStyle !== '3d' ? 'active' : ''}`}
              onClick={() => setStyle('2d')}
            >
              2D
            </button>
            <button
              type="button"
              className={`drill-view-btn ${boardStyle === '3d' ? 'active' : ''}`}
              onClick={() => setStyle('3d')}
            >
              3D
            </button>
          </div>

          {/* Timer */}
          <div
            style={{
              fontFamily: 'monospace',
              fontWeight: 700,
              fontSize: '0.95rem',
              color: timeTaken > 60 ? '#f59e0b' : 'var(--royal-crimson, #8B2500)',
              background: 'var(--surface-1, rgba(0, 0, 0, 0.06))',
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid var(--surface-line, rgba(212, 175, 55, 0.2))',
            }}
          >
            ⏱ {formatTimer(timeTaken)}
          </div>
        </div>
      </div>

      {/* Visual Move Comparison Selector (Active when incorrect) */}
      {attemptState && !attemptState.isCorrect && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            marginBottom: 10,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => setDisplayMode('best')}
            style={{
              background: displayMode === 'best' ? '#10b981' : 'var(--surface-card, rgba(0,0,0,0.06))',
              color: displayMode === 'best' ? '#ffffff' : 'var(--royal-ink, #1C1008)',
              border: `1.5px solid ${displayMode === 'best' ? '#10b981' : 'var(--royal-border, rgba(212, 175, 55, 0.35))'}`,
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s ease',
            }}
          >
            <span>🟢 Best Move:</span>
            <span>{bestDetails?.san || attemptState.bestMove}</span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode('played')}
            style={{
              background: displayMode === 'played' ? '#ef4444' : 'var(--surface-card, rgba(0,0,0,0.06))',
              color: displayMode === 'played' ? '#ffffff' : 'var(--royal-ink, #1C1008)',
              border: `1.5px solid ${displayMode === 'played' ? '#ef4444' : 'var(--royal-border, rgba(212, 175, 55, 0.35))'}`,
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s ease',
            }}
          >
            <span>🔴 Your Move:</span>
            <span>{playedDetails?.san || attemptState.movePlayed}</span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode('compare')}
            style={{
              background: displayMode === 'compare' ? 'var(--royal-gold, #D4AF37)' : 'var(--surface-card, rgba(0,0,0,0.06))',
              color: displayMode === 'compare' ? '#1C1008' : 'var(--royal-ink, #1C1008)',
              border: `1.5px solid ${displayMode === 'compare' ? 'var(--royal-gold, #D4AF37)' : 'var(--royal-border, rgba(212, 175, 55, 0.35))'}`,
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s ease',
            }}
          >
            <span>🔍 Compare Both</span>
          </button>
        </div>
      )}

      {/* Main Board Container */}
      <div
        className="drill-board-container"
        style={{
          borderColor: boardBorderColor,
          boxShadow: attemptState
            ? attemptState.isCorrect
              ? '0 16px 40px rgba(16, 185, 129, 0.25)'
              : '0 16px 40px rgba(239, 68, 68, 0.25)'
            : undefined,
        }}
      >
        {boardStyle === '3d' ? (
          <Suspense
            fallback={
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--royal-gold, #D4AF37)',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                }}
              >
                Loading 3D Board…
              </div>
            }
          >
            <Board3D
              fen={activeFen}
              playerColor={turn}
              onMove={handleBoardMove}
              disabled={disabled || (attemptState !== null && !attemptState.isCorrect)}
              lastMove={lastMove}
              onFallbackTo2D={() => setStyle('2d')}
            />
          </Suspense>
        ) : (
          <Board2D
            id="drillBoard2D"
            fen={activeFen}
            playerColor={turn}
            onMove={handleBoardMove}
            disabled={disabled || (attemptState !== null && !attemptState.isCorrect)}
            lastMove={lastMove}
            highlightSquares={highlightSquares}
            arrows={arrows}
          />
        )}
      </div>
    </div>
  );
}
