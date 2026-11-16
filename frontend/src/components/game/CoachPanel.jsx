import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../../store/gameStore';
import CandidateLab from './CandidateLab';

export default function CoachPanel({ onPlayMove, onActiveChange }) {
  const navigate = useNavigate();
  const gameId      = useGameStore(s => s.gameId);
  const fen       = useGameStore(s => s.fen);
  const result    = useGameStore(s => s.result);
  const gameMode  = useGameStore(s => s.mode);
  const playerColor = useGameStore(s => s.playerColor);

  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
  }, [fen]);

  const canPlayMove = useMemo(() => {
    if (result || !fen || typeof fen !== 'string') return false;
    const turn = fen.split(' ')[1] === 'b' ? 'black' : 'white';
    return turn === playerColor;
  }, [result, fen, playerColor]);

  const canGenerateMove = useMemo(() => {
    if (!fen || typeof fen !== 'string') return false;
    if (gameMode === 'pass_and_play') return true;
    const turn = fen.split(' ')[1] === 'b' ? 'black' : 'white';
    return turn === playerColor;
  }, [fen, playerColor, gameMode]);

  return (
    <div className="coach-panel">
      {error && <div className="alert alert-error" style={{ margin: '6px', fontSize: '0.75rem' }}>{error}</div>}

      <CandidateLab
        fen={fen}
        playerColor={playerColor}
        canPlay={canPlayMove}
        canGenerate={canGenerateMove}
        onPlayMove={onPlayMove}
        onActiveChange={onActiveChange}
      />

      {result && (
        <button className="btn-neon interactive coach-action-btn"
          onClick={() => navigate(`/review/${gameId}?report=1`)}>
          📊 Full Game Report
        </button>
      )}
    </div>
  );
}