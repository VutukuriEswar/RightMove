import React from 'react';
import { gameResultClass, resultLabel } from '../../lib/broadcastUtils';

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

export default function GameList({ games = [], selectedId, onSelect }) {
  if (!games.length) {
    return <p className="ev-empty-note">No games have been published for this round yet.</p>;
  }

  return (
    <div className="ev-game-list" role="list">
      {games.map((game, index) => {
        const resultClass = gameResultClass(game.result);
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
              <span className="ev-game-player">
                <span className="ev-game-color ev-game-color-white" aria-hidden="true" />
                <span className="ev-game-name">{game.white}</span>
                {game.white_rating ? (
                  <span className="ev-game-rating mono">{game.white_rating}</span>
                ) : null}
              </span>
              <span className="ev-game-player">
                <span className="ev-game-color ev-game-color-black" aria-hidden="true" />
                <span className="ev-game-name">{game.black}</span>
                {game.black_rating ? (
                  <span className="ev-game-rating mono">{game.black_rating}</span>
                ) : null}
              </span>
            </span>
            <span className={`ev-game-result ev-game-result-${resultClass}`}>
              {resultLabel(game.result)}
            </span>
            {analysisDot(game.analysis)}
          </button>
        );
      })}
    </div>
  );
}
