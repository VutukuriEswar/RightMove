import React, { useState, useEffect, useCallback } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';

export default function DrillBoard({
  fen,
  onMove,
  disabled = false,
  attemptState = null,
  timeTaken = 0,
}) {
  const [game, setGame] = useState(() => {
    try {
      return new Chess(fen);
    } catch (_) {
      return new Chess();
    }
  });

  const [customSquareStyles, setCustomSquareStyles] = useState({});

  useEffect(() => {
    try {
      const nextGame = new Chess(fen);
      setGame(nextGame);
      setCustomSquareStyles({});
    } catch (_) {
      setGame(new Chess());
      setCustomSquareStyles({});
    }
  }, [fen]);

  const turn = game.turn() === 'w' ? 'white' : 'black';
  const turnLabel = turn === 'white' ? 'White to move' : 'Black to move';

  useEffect(() => {
    if (!attemptState) {
      setCustomSquareStyles({});
      return;
    }

    const styles = {};
    if (attemptState.isCorrect) {
      if (attemptState.movePlayed) {
        styles[attemptState.movePlayed.slice(-2)] = {
          backgroundColor: 'rgba(16, 185, 129, 0.4)',
        };
      }
    } else {
      if (attemptState.movePlayed) {
        styles[attemptState.movePlayed.slice(-2)] = {
          backgroundColor: 'rgba(239, 68, 68, 0.4)',
        };
      }
      if (attemptState.bestMove) {
        styles[attemptState.bestMove.slice(-2)] = {
          backgroundColor: 'rgba(56, 189, 248, 0.4)',
        };
      }
    }
    setCustomSquareStyles(styles);
  }, [attemptState]);

  const onDrop = useCallback(
    (sourceSquare, targetSquare, piece) => {
      if (disabled || (attemptState && !attemptState.isCorrect)) return false;

      let move = null;
      try {
        const testGame = new Chess(game.fen());
        move = testGame.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: 'q',
        });
      } catch (_) {
        return false;
      }

      if (!move) return false;

      setGame(new Chess(move.after || game.fen()));
      const uci = `${sourceSquare}${targetSquare}${move.promotion ? 'q' : ''}`;
      if (onMove) {
        onMove(move.san, uci);
      }
      return true;
    },
    [disabled, attemptState, game, onMove]
  );

  const formatTimer = (secs) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: 520,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          marginBottom: 8,
          background: 'rgba(15, 23, 42, 0.6)',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'inline-block',
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: turn === 'white' ? '#fff' : '#0f172a',
              border: '2px solid #94a3b8',
            }}
          />
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#e2e8f0' }}>
            {turnLabel} · Find the best move
          </span>
        </div>
        <div
          style={{
            fontFamily: 'monospace',
            fontWeight: 700,
            fontSize: '1rem',
            color: timeTaken > 60 ? '#f59e0b' : '#38bdf8',
          }}
        >
          ⏱ {formatTimer(timeTaken)}
        </div>
      </div>

      <div
        style={{
          width: '100%',
          aspectRatio: '1/1',
          position: 'relative',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
          border: attemptState
            ? attemptState.isCorrect
              ? '2px solid #10b981'
              : '2px solid #ef4444'
            : '2px solid rgba(255, 255, 255, 0.1)',
          transition: 'border 0.3s ease',
        }}
      >
        <Chessboard
          position={game.fen()}
          onPieceDrop={onDrop}
          boardOrientation={turn}
          customSquareStyles={customSquareStyles}
          arePiecesDraggable={!disabled && attemptState === null}
          customDarkSquareStyle={{ backgroundColor: '#1e293b' }}
          customLightSquareStyle={{ backgroundColor: '#334155' }}
          animationDuration={250}
        />
      </div>
    </div>
  );
}
