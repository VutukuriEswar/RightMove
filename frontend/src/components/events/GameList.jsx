import React from 'react';
import { gameResultClass } from '../../lib/broadcastUtils';

function analysisDot(analysis) {
  if (!analysis) return null;
  if (analysis.status === 'done') {
    if (analysis.finished === false) {
      return <span className="ev-game-dot ev-game-dot-queued" title="Partial analysis (game in progress)" />;
    }
    return <span className="ev-game-dot ev-game-dot-done" title="Analysis ready" />;
  }
  if (analysis.status === 'running') {
    return <span className="ev-game-dot ev-game-dot-running" title="Analysing" />;
  }
  if (analysis.status === 'queued') {
    return <span className="ev-game-dot ev-game-dot-queued" title="Queued for analysis" />;
  }
  return null;
}

function winnerBadge(result) {
  if (result === '1-0') {
    return <span className="ev-game-winner-tag ev-winner-white">1 - 0 White</span>;
  }
  if (result === '0-1') {
    return <span className="ev-game-winner-tag ev-winner-black">0 - 1 Black</span>;
  }
  if (result === '1/2-1/2') {
    return <span className="ev-game-winner-tag ev-winner-draw">½ - ½ Draw</span>;
  }
  return <span className="ev-game-winner-tag ev-winner-live"><span className="ev-live-dot" />Live</span>;
}

export default function GameList({ games = [], selectedId, onSelect }) {
  if (!games.length) {
    return <p className="ev-empty-note">No games have been published for this round yet.</p>;
  }

  return (
    <div className="ev-game-list" role="list">
      {games.map((game, index) => {
        const resultClass = gameResultClass(game.result);
        const isWhiteWinner = game.result === '1-0';
        const isBlackWinner = game.result === '0-1';

        return (
          <button
            type="button"
            key={game.id || index}
            className={`ev-game-row interactive${selectedId === game.id ? ' is-selected' : ''}`}
            onClick={() => onSelect?.(game)}
            role="listitem"
          >
            <span className="ev-game-board-no">{index + 1}</span>
            <span className="ev-game-players">
              <span className={`ev-game-player${isWhiteWinner ? ' is-winner' : ''}`}>
                <span className="ev-game-color ev-game-color-white" aria-hidden="true" />
                <span className="ev-game-name">{game.white}</span>
                {isWhiteWinner && <span className="ev-crown" title="Winner">👑</span>}
                {game.white_rating ? (
                  <span className="ev-game-rating mono">{game.white_rating}</span>
                ) : null}
              </span>
              <span className={`ev-game-player${isBlackWinner ? ' is-winner' : ''}`}>
                <span className="ev-game-color ev-game-color-black" aria-hidden="true" />
                <span className="ev-game-name">{game.black}</span>
                {isBlackWinner && <span className="ev-crown" title="Winner">👑</span>}
                {game.black_rating ? (
                  <span className="ev-game-rating mono">{game.black_rating}</span>
                ) : null}
              </span>
            </span>
            <span className={`ev-game-result ev-game-result-${resultClass}`}>
              {winnerBadge(game.result)}
            </span>
            {analysisDot(game.analysis)}
          </button>
        );
      })}
    </div>
  );
}
