import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { buildPositions, decodeSharePayload, moveRecordToSquares } from '../lib/chessUtils';
import Board2D from '../components/board/Board2D';
import MoveList from '../components/game/MoveList';

const ENGINE_INTERVAL_MS = 800;

export default function SharedReview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [currentMoveIdx, setCurrentMoveIdx] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const playTimerRef = useRef(null);

  useEffect(() => {
    try {
      const hash = window.location.hash.slice(1);
      if (!hash) throw new Error('No game data in link.');
      const parsed = decodeSharePayload(hash);
      if (!parsed || !Array.isArray(parsed.moves)) throw new Error('Bad payload.');
      setData(parsed);
      setCurrentMoveIdx(parsed.moves ? parsed.moves.length - 1 : -1);
    } catch (e) {
      setError('Invalid or corrupted share link.');
    }
  }, []);

  const moves   = useMemo(() => data?.moves || [], [data?.moves]);
  const meta    = data?.meta   || {};
  const isEngine = meta.mode === 'bot';

  const fens = useMemo(() => {
    if (!moves.length) return ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];
    return buildPositions(moves.map(m => m.san));
  }, [moves]);

  const scheduleNext = useCallback((fromIdx) => {
    if (fromIdx >= moves.length - 1) { setIsPlaying(false); return; }
    const nextMove = moves[fromIdx + 1];
    const delay = (isEngine || !nextMove?.elapsed_ms)
      ? ENGINE_INTERVAL_MS
      : Math.min(Math.max(nextMove.elapsed_ms, 300), 8000);
    playTimerRef.current = setTimeout(() => {
      setCurrentMoveIdx(prev => { const next = prev + 1; scheduleNext(next); return next; });
    }, delay);
  }, [moves, isEngine]);

  useEffect(() => {
    if (!isPlaying) { if (playTimerRef.current) clearTimeout(playTimerRef.current); return; }
    if (currentMoveIdx >= moves.length - 1) { setCurrentMoveIdx(-1); scheduleNext(-1); }
    else { scheduleNext(currentMoveIdx); }
    return () => { if (playTimerRef.current) clearTimeout(playTimerRef.current); };

  }, [isPlaying]);

  const step = (delta) => { setIsPlaying(false); setCurrentMoveIdx(prev => Math.max(-1, Math.min(moves.length - 1, prev + delta))); };

  if (error) return (
    <div className="page" style={{ paddingTop: '96px', textAlign: 'center' }}>
      <p style={{ color: 'var(--royal-crimson)', fontSize: '1.1rem' }}>{error}</p>
      <p style={{ marginTop: '12px' }}>
        <Link to="/lobby" className="btn btn-secondary">Back to safety</Link>
      </p>
    </div>
  );
  if (!data) return <div className="page" style={{ paddingTop: '96px' }}><div className="spinner-large" /></div>;

  const currentFen = fens[currentMoveIdx + 1];
  const lastMove   = currentMoveIdx >= 0 ? moves[currentMoveIdx] : null;
  const lastMoveSq = moveRecordToSquares(lastMove);

  return (
    <div className="review-page page-full">
      <div className="review-layout">
        <div className="review-main">
          <div className="shared-meta card" style={{ width: '100%', maxWidth: '600px', padding: '16px 20px' }}>
            <p style={{ fontFamily: 'Cinzel,serif', fontSize: '0.8rem', letterSpacing: '0.06em', color: 'var(--royal-brass)', marginBottom: '4px' }}>SHARED MATCH</p>
            <p style={{ color: 'var(--royal-ink)', fontFamily: 'Lora,Georgia,serif' }}>
              vs {meta.opponent || 'Unknown'} &nbsp;·&nbsp; {meta.result || '?'}
            </p>
          </div>

          <div className="review-board-container">
            <div className="board-wrapper">
              <Board2D id="sharedBoard" fen={currentFen} disabled={true} lastMove={lastMoveSq} />
            </div>
            <div className="review-controls-bottom">
              <button
                className="btn btn-secondary review-nav-btn"
                title="Start"
                aria-label="First move"
                onClick={() => { setIsPlaying(false); setCurrentMoveIdx(-1); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                </svg>
              </button>
              <button
                className="btn btn-secondary review-nav-btn"
                title="Prev"
                aria-label="Previous move"
                onClick={() => step(-1)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 18l-9-6 9-6v12z"/>
                </svg>
              </button>
              <button
                className={`review-play-btn ${isPlaying ? 'playing' : ''}`}
                title={isPlaying ? 'Pause' : 'Play'}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                onClick={() => setIsPlaying(p => !p)}
              >
                {isPlaying ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                )}
              </button>
              <button
                className="btn btn-secondary review-nav-btn"
                title="Next"
                aria-label="Next move"
                onClick={() => step(1)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6l9 6-9 6V6z"/>
                </svg>
              </button>
              <button
                className="btn btn-secondary review-nav-btn"
                title="End"
                aria-label="Last move"
                onClick={() => { setIsPlaying(false); setCurrentMoveIdx(moves.length - 1); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6v12l8.5-6zm10 0h2v12h-2z"/>
                </svg>
              </button>
            </div>
            <p className="review-hint">Arrow keys to navigate · Space to play/pause</p>
          </div>
        </div>

        <div className="review-sidebar">
          <div className="move-list-container card">
            <MoveList moves={moves} activeIndex={currentMoveIdx} onMoveClick={(idx) => { setIsPlaying(false); setCurrentMoveIdx(idx); }} />
          </div>
        </div>
      </div>
    </div>
  );
}
