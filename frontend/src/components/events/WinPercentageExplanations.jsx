import React from 'react';

export default function WinPercentageExplanations({
  whiteExplanation,
  blackExplanation,
  whiteTitle,
  blackTitle,
  whiteAvatar,
  blackAvatar,
  whiteRating,
  blackRating,
}) {
  if (!whiteExplanation || !blackExplanation) return null;

  return (
    <div className="ev-explanations-grid">
      <div className="ev-explanation-card white-card">
        <div className="ev-exp-head">
          <div className="ev-exp-player-left">
            <div className="player-avatar ev-avatar">
              {whiteAvatar ? (
                <img
                  src={whiteAvatar}
                  alt={whiteExplanation.playerName}
                  className="ev-avatar-img"
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fb = e.currentTarget.parentElement?.querySelector('.ev-avatar-fallback');
                    if (fb) fb.style.display = 'flex';
                  }}
                />
              ) : null}
              <span
                className="ev-avatar-fallback"
                style={{ display: whiteAvatar ? 'none' : 'flex' }}
              >
                {(whiteExplanation.playerName || 'W').charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="ev-exp-meta">
              <div className="ev-exp-name-row">
                {whiteTitle && <span className="ev-player-title-pill">{whiteTitle}</span>}
                <span className="ev-exp-name">{whiteExplanation.playerName}</span>
              </div>
              {whiteRating && <span className="ev-exp-sub mono">{whiteRating} ELO</span>}
            </div>
          </div>
          <div className="ev-exp-badge-wrap">
            <span className="ev-exp-win-badge white-win">
              ♔ {whiteExplanation.winPct}% Win Chance
            </span>
          </div>
        </div>

        <div className="ev-exp-body">
          <div className="ev-exp-row">
            <div className="ev-exp-label">
              <span className="ev-exp-icon">⚖</span>
              <strong>Material & Balance</strong>
            </div>
            <p className="ev-exp-text">{whiteExplanation.materialText}</p>
          </div>

          <div className="ev-exp-row">
            <div className="ev-exp-label">
              <span className="ev-exp-icon">⚔</span>
              <strong>Piece Activity & Central Control</strong>
            </div>
            <p className="ev-exp-text">{whiteExplanation.piecesText}</p>
          </div>

          <div className="ev-exp-row">
            <div className="ev-exp-label">
              <span className="ev-exp-icon">🛡</span>
              <strong>King Shelter & Structure</strong>
            </div>
            <p className="ev-exp-text">{whiteExplanation.kingText}</p>
          </div>

          <div className="ev-exp-row verdict-row">
            <div className="ev-exp-label">
              <span className="ev-exp-icon">💡</span>
              <strong>Why Stockfish Evaluates This Win %</strong>
            </div>
            <p className="ev-exp-text highlight">{whiteExplanation.verdictText}</p>
          </div>
        </div>
      </div>

      <div className="ev-explanation-card black-card">
        <div className="ev-exp-head">
          <div className="ev-exp-player-left">
            <div className="player-avatar ev-avatar">
              {blackAvatar ? (
                <img
                  src={blackAvatar}
                  alt={blackExplanation.playerName}
                  className="ev-avatar-img"
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fb = e.currentTarget.parentElement?.querySelector('.ev-avatar-fallback');
                    if (fb) fb.style.display = 'flex';
                  }}
                />
              ) : null}
              <span
                className="ev-avatar-fallback"
                style={{ display: blackAvatar ? 'none' : 'flex' }}
              >
                {(blackExplanation.playerName || 'B').charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="ev-exp-meta">
              <div className="ev-exp-name-row">
                {blackTitle && <span className="ev-player-title-pill">{blackTitle}</span>}
                <span className="ev-exp-name">{blackExplanation.playerName}</span>
              </div>
              {blackRating && <span className="ev-exp-sub mono">{blackRating} ELO</span>}
            </div>
          </div>
          <div className="ev-exp-badge-wrap">
            <span className="ev-exp-win-badge black-win">
              ♚ {blackExplanation.winPct}% Win Chance
            </span>
          </div>
        </div>

        <div className="ev-exp-body">
          <div className="ev-exp-row">
            <div className="ev-exp-label">
              <span className="ev-exp-icon">⚖</span>
              <strong>Material & Balance</strong>
            </div>
            <p className="ev-exp-text">{blackExplanation.materialText}</p>
          </div>

          <div className="ev-exp-row">
            <div className="ev-exp-label">
              <span className="ev-exp-icon">⚔</span>
              <strong>Piece Activity & Central Control</strong>
            </div>
            <p className="ev-exp-text">{blackExplanation.piecesText}</p>
          </div>

          <div className="ev-exp-row">
            <div className="ev-exp-label">
              <span className="ev-exp-icon">🛡</span>
              <strong>King Shelter & Structure</strong>
            </div>
            <p className="ev-exp-text">{blackExplanation.kingText}</p>
          </div>

          <div className="ev-exp-row verdict-row">
            <div className="ev-exp-label">
              <span className="ev-exp-icon">💡</span>
              <strong>Why Stockfish Evaluates This Win %</strong>
            </div>
            <p className="ev-exp-text highlight">{blackExplanation.verdictText}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

