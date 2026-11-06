import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../../store/gameStore';
import { coachApi } from '../../lib/api';
import { buildPositions, formatEval, CLASSIFICATION_META, uciToSquares } from '../../lib/chessUtils';
import CandidateLab from './CandidateLab';

export default function CoachPanel({ onPlayMove, onActiveChange }) {
  const navigate = useNavigate();
  const gameId      = useGameStore(s => s.gameId);
  const fen       = useGameStore(s => s.fen);
  const moves     = useGameStore(s => s.moves);
  const result    = useGameStore(s => s.result);
  const gameMode  = useGameStore(s => s.mode);
  const playerColor = useGameStore(s => s.playerColor);
  const humanMoveFeedback = useGameStore(s => s.humanMoveFeedback);

  const [error, setError] = useState(null);

  const fenBefore = useMemo(() => {
    try {
      if (!Array.isArray(moves) || moves.length === 0) return null;
      const sans = moves.map(m => m?.san).filter(s => typeof s === 'string');
      if (sans.length === 0) return null;
      const positions = buildPositions(sans);
      if (!Array.isArray(positions) || positions.length < 2) return null;
      return positions[positions.length - 2] || null;
    } catch (_) {
      return null;
    }
  }, [moves]);

  const lastHumanMove = useMemo(() => {
    if (!Array.isArray(moves)) return null;
    for (let i = moves.length - 1; i >= 0; i--) {
      if (moves[i] && !moves[i].is_bot && typeof moves[i].uci === 'string') return moves[i];
    }
    return null;
  }, [moves]);

  const [moveExplanation, setMoveExplanation] = useState(null);
  const [moveExplainBusy, setMoveExplainBusy] = useState(false);
  const [moveExplainError, setMoveExplainError] = useState(null);
  const explainedKeyRef = useRef(null);

  const moveKey = lastHumanMove
    ? `${lastHumanMove.uci}@${Number.isFinite(lastHumanMove.ply) ? lastHumanMove.ply : moves.length}`
    : null;
  const explainKey = moveKey ? `${moveKey}::${humanMoveFeedback ? 'fb' : 'nofb'}` : null;

  useEffect(() => {
    if (!explainKey || !fenBefore || !uciToSquares(lastHumanMove?.uci)) return;
    if (explainedKeyRef.current === explainKey) return;
    explainedKeyRef.current = explainKey;
    let cancelled = false;
    setMoveExplainBusy(true);
    setMoveExplainError(null);
    setMoveExplanation(null);
    (async () => {
      try {
        const fb = useGameStore.getState().humanMoveFeedback;
        const cpLoss = fb && Number.isFinite(fb.eval_before) && Number.isFinite(fb.eval_after)
          ? (fb.eval_before - fb.eval_after) : 0;
        const data = await coachApi.explain(fenBefore, lastHumanMove.uci, null,
          cpLoss,
          fb?.classification ? { classification: fb.classification } : null);
        if (cancelled) return;
        if (data?.error) throw new Error(data.error);
        setMoveExplanation(data);
      } catch (e) {
        if (cancelled) return;
        setMoveExplainError(e.message || 'Explanation failed');
      } finally {
        if (!cancelled) setMoveExplainBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [explainKey, fenBefore]);

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

      {humanMoveFeedback?.classification && (
        <div className="coach-card card">
          <h4 className="coach-card-title">
            {CLASSIFICATION_META[humanMoveFeedback.classification]?.emoji || 'ℹ'}
            <span style={{ textTransform: 'uppercase' }}>
              {humanMoveFeedback.classification || 'Move'} — {formatEval(humanMoveFeedback.eval_before)} → {formatEval(humanMoveFeedback.eval_after)}
            </span>
          </h4>
          {moveExplainBusy && <p className="coach-text">Explaining your move…</p>}
          {moveExplainError && <div className="alert alert-error" style={{ fontSize: '0.75rem' }}>{moveExplainError}</div>}
          {moveExplanation && !moveExplainBusy && (
            <>
              <p className="coach-text"><strong>Strengths:</strong> {moveExplanation.thing_1?.summary || 'Solid developing move.'}</p>
              {moveExplanation.thing_2?.has_defects && (
                <p className="coach-text"><strong>Weaknesses:</strong> {moveExplanation.thing_2?.summary}</p>
              )}
              {moveExplanation.best_move?.san && (
                <p className="coach-text"><strong>Best:</strong> {moveExplanation.best_move.san} — {moveExplanation.best_move?.summary || ''}</p>
              )}
            </>
          )}
        </div>
      )}

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