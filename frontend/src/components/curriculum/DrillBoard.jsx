import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { Chess } from 'chess.js';
import Board2D from '../board/Board2D';
import { useBoardThemeStore } from '../../store/boardThemeStore';

const Board3D = lazy(() => import('../board/Board3D'));

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

  useEffect(() => {
    try {
      const nextGame = new Chess(fen);
      setGame(nextGame);
      setLastMove(null);
    } catch (_) {
      setGame(new Chess());
      setLastMove(null);
    }
  }, [fen]);

  const turn = game.turn() === 'w' ? 'white' : 'black';
  const turnLabel = turn === 'white' ? 'White to move' : 'Black to move';

  // Highlight squares when move attempt is evaluated
  const highlightSquares = useMemo(() => {
    if (!attemptState) return [];
    const list = [];
    if (attemptState.movePlayed && attemptState.movePlayed.length >= 4) {
      list.push(attemptState.movePlayed.slice(0, 2), attemptState.movePlayed.slice(2, 4));
    }
    if (attemptState.bestMove && attemptState.bestMove.length >= 4) {
      list.push(attemptState.bestMove.slice(0, 2), attemptState.bestMove.slice(2, 4));
    }
    return list;
  }, [attemptState]);

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
              fen={game.fen()}
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
            fen={game.fen()}
            playerColor={turn}
            onMove={handleBoardMove}
            disabled={disabled || (attemptState !== null && !attemptState.isCorrect)}
            lastMove={lastMove}
            highlightSquares={highlightSquares}
          />
        )}
      </div>
    </div>
  );
}
