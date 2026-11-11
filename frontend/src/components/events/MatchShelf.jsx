import React, { useRef, memo } from 'react';
import { Chessboard } from 'react-chessboard';
import { lastMoveSquares } from '../../lib/broadcastUtils';

function parseResultScores(result) {
  if (result === '1-0') return { white: '1', black: '0' };
  if (result === '0-1') return { white: '0', black: '1' };
  if (result === '1/2-1/2' || result === '½-½') return { white: '½', black: '½' };
  return { white: '', black: '' };
}

const MiniBoard = memo(function MiniBoard({ fen, lastMoveUci, gameId }) {
  const sqs = lastMoveSquares(lastMoveUci);
  const squareStyles = {};
  if (sqs?.from && sqs?.to) {
    squareStyles[sqs.from] = { background: 'rgba(212, 175, 55, 0.45)' };
    squareStyles[sqs.to] = { background: 'rgba(212, 175, 55, 0.55)' };
  }

  return (
    <div className="ev-match-miniboard-wrap">
      <Chessboard
        options={{
          id: `shelf-${gameId || 'mini'}`,
          position: fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          boardOrientation: 'white',
          showNotation: false,
          allowDragging: false,
          squareStyles,
          boardStyle: {
            borderRadius: '4px',
            boxShadow: 'none',
          },
          darkSquareStyle: { backgroundColor: '#8A5A36' },
          lightSquareStyle: { backgroundColor: '#D9B98A' },
          animationDurationInMs: 0,
        }}
      />
    </div>
  );
});

const MatchCard = memo(function MatchCard({ game, index, isSelected, onSelect }) {
  const scores = parseResultScores(game.result);
  const isLive = game.result === '*';
  const isWhiteWin = game.result === '1-0';
  const isBlackWin = game.result === '0-1';

  return (
    <div
      role="button"
      tabIndex={0}
      className={`ev-match-card interactive${isSelected ? ' is-selected' : ''}`}
      onClick={() => onSelect?.(game)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.(game);
        }
      }}
    >
      <div className="ev-match-card-player top">
        <div className="ev-match-player-meta">
          {game.white_fed && <span className="ev-fed-pill">{game.white_fed}</span>}
          {game.white_title && <span className="ev-player-title-pill">{game.white_title}</span>}
          <span className={`ev-match-player-name${isWhiteWin ? ' is-winner' : ''}`} title={game.white}>
            {game.white}
          </span>
        </div>
        <span className={`ev-match-score mono${isWhiteWin ? ' is-winner-score' : ''}`}>
          {scores.white}
        </span>
      </div>

      <MiniBoard fen={game.fen} lastMoveUci={game.last_move} gameId={game.id || index} />

      <div className="ev-match-card-player bottom">
        <div className="ev-match-player-meta">
          {game.black_fed && <span className="ev-fed-pill">{game.black_fed}</span>}
          {game.black_title && <span className="ev-player-title-pill">{game.black_title}</span>}
          <span className={`ev-match-player-name${isBlackWin ? ' is-winner' : ''}`} title={game.black}>
            {game.black}
          </span>
        </div>
        <span className={`ev-match-score mono${isBlackWin ? ' is-winner-score' : ''}`}>
          {scores.black}
        </span>
      </div>

      <div className="ev-match-card-footer">
        <span className="ev-match-board-tag mono">Board {index + 1}</span>
        {isLive ? (
          <span className="ev-live-mini-badge">
            <span className="ev-live-dot" /> Live
          </span>
        ) : game.last_move ? (
          <span className="ev-match-last-move mono">{game.last_move}</span>
        ) : (
          <span className="ev-match-result-tag mono">{game.result || '*'}</span>
        )}
      </div>
    </div>
  );
});

export default function MatchShelf({ games = [], selectedId, onSelect, roundName = 'Round' }) {
  const trackRef = useRef(null);

  const scrollLeft = () => {
    if (trackRef.current) {
      const w = trackRef.current.clientWidth;
      trackRef.current.scrollBy({ left: -w, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (trackRef.current) {
      const w = trackRef.current.clientWidth;
      trackRef.current.scrollBy({ left: w, behavior: 'smooth' });
    }
  };

  if (!games.length) {
    return (
      <section className="ev-matches-shelf glass-panel">
        <div className="ev-matches-shelf-head">
          <h3 className="ev-section-title">{roundName} Matches</h3>
        </div>
        <p className="ev-empty-note">No matches published for this round yet.</p>
      </section>
    );
  }

  return (
    <section className="ev-matches-shelf glass-panel" aria-label="Matches in this round">
      <div className="ev-matches-shelf-head">
        <div className="ev-matches-title-wrap">
          <p className="ev-kicker">{roundName}</p>
          <h3 className="ev-section-title">
            Matches ({games.length})
          </h3>
          <span className="ev-matches-hint">5 visible at a time · Scroll for more</span>
        </div>
        <div className="ev-shelf-arrows">
          <button
            type="button"
            className="ev-shelf-arrow-btn interactive"
            onClick={scrollLeft}
            aria-label="Previous matches"
          >
            ‹
          </button>
          <button
            type="button"
            className="ev-shelf-arrow-btn interactive"
            onClick={scrollRight}
            aria-label="Next matches"
          >
            ›
          </button>
        </div>
      </div>

      <div className="ev-matches-track-wrap">
        <div className="ev-matches-track" ref={trackRef}>
          {games.map((g, idx) => (
            <MatchCard
              key={g.id || idx}
              game={g}
              index={idx}
              isSelected={g.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

