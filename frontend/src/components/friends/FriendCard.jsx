import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

const FORM_CLASS = { win: 'form-w', draw: 'form-d', loss: 'form-l' };
const FORM_LABEL = { win: 'Won', draw: 'Drew', loss: 'Lost' };

const TC_OPTIONS = [
  { label: 'No timer', sublabel: 'Casual (Untimed)', tc: 0, inc: 0, icon: '♾️', badge: 'Casual' },
  { label: '1 min', sublabel: 'Bullet · 1+0', tc: 60, inc: 0, icon: '⚡', badge: 'Bullet' },
  { label: '3 min', sublabel: 'Blitz · 3+0', tc: 180, inc: 0, icon: '🔥', badge: 'Blitz' },
  { label: '5 min', sublabel: 'Blitz · 5+0', tc: 300, inc: 0, icon: '⚔️', badge: 'Blitz' },
  { label: '10 min', sublabel: 'Rapid · 10+0', tc: 600, inc: 0, icon: '🏆', badge: 'Rapid' },
  { label: '30 min', sublabel: 'Classical · 30+0', tc: 1800, inc: 0, icon: '📜', badge: 'Classical' },
];

const COLOR_OPTIONS = [
  { id: 'random', label: '🎲 Random' },
  { id: 'white', label: '⚪ White' },
  { id: 'black', label: '⚫ Black' },
];

function tcLabel(tc, inc) {
  if (!tc || tc === 0) return 'No timer';
  if (tc < 60) return `${tc}s`;
  const m = Math.round(tc / 60);
  return inc ? `${m}+${inc}` : `${m} min`;
}

export default function FriendCard({
  friend,
  isOnline,
  record,
  spotlight,
  busy,
  waiting,
  onChallenge,
  onChallengePgn,
  onRemove,
  pausedMatches = [],
  onResumeGame,
  onResignPaused,
}) {
  const navigate = useNavigate();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [selectedTcIndex, setSelectedTcIndex] = useState(0);
  const [selectedColor, setSelectedColor] = useState('random');
  const [showHistory, setShowHistory] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [importingPgn, setImportingPgn] = useState(false);
  const dropdownRef = useRef(null);
  const pgnFileRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDropdownOpen]);

  const selectedTc = TC_OPTIONS[selectedTcIndex] || TC_OPTIONS[0];
  const matches = record?.matches ?? null;
  const hasBattles = matches !== null && matches > 0;
  const recentGames = record?.recent || [];

  const handleChallengeClick = () => {
    if (waiting) {
      onChallenge?.(friend.username, 0, 0, 'random', true);
    } else {
      onChallenge?.(
        friend.username,
        selectedTc.tc,
        selectedTc.inc,
        selectedColor,
        false
      );
    }
  };

  const handlePgnFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportingPgn(true);
    try {
      const text = await file.text();
      onChallengePgn?.(
        friend.username,
        text,
        selectedTc.tc,
        selectedTc.inc,
        selectedColor
      );
    } catch (_) {
    } finally {
      setImportingPgn(false);
    }
  };

  return (
    <motion.div
      className={`friend-card card${spotlight ? ' friend-spotlight' : ''}`}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.18 }}
    >
      {spotlight && (
        <div className="friend-spotlight-crown" title="Your #1 Most Played Rival">
          <span className="crown-icon">👑</span>
          <span className="crown-text">Top Rival</span>
        </div>
      )}

      <div className="friend-top-header">
        <div className="friend-avatar-wrap">
          <div className="friend-avatar">
            {friend.username[0].toUpperCase()}
          </div>
          <span
            className={`friend-status-dot ${isOnline ? 'online' : 'offline'}`}
            title={isOnline ? 'Online' : 'Offline'}
          />
        </div>

        <div className="friend-identity">
          <div className="friend-name-row">
            <span className="friend-name">{friend.username}</span>
            <span className={`status-pill ${isOnline ? 'status-online' : 'status-offline'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          {record && hasBattles ? (
            <span className="rivalry-badge">{record.title}</span>
          ) : (
            <span className="new-rival-tag">Ready for battle</span>
          )}
        </div>
      </div>

      <div className="friend-body">
        {record && hasBattles ? (
          <div className="friend-record-box">
            <div className="friend-score-chips">
              <span className="score-chip score-win" title="Victories against this rival">
                <strong>{record.wins}</strong> W
              </span>
              <span className="score-chip score-draw" title="Draws against this rival">
                <strong>{record.draws}</strong> D
              </span>
              <span className="score-chip score-loss" title="Defeats against this rival">
                <strong>{record.losses}</strong> L
              </span>
              <span className="winrate-chip">
                {record.win_rate}% Win Rate
              </span>
            </div>

            {record.form?.length > 0 && (
              <div className="friend-form-row">
                <span className="friend-form-label">Recent Form:</span>
                <div className="friend-form-dots">
                  {record.form.map((r, i) => (
                    <span
                      key={i}
                      className={`form-dot ${FORM_CLASS[r] || 'form-d'}`}
                      title={FORM_LABEL[r] || r}
                    />
                  ))}
                </div>
              </div>
            )}

            {record.milestones?.length > 0 && (
              <div className="friend-milestones">
                {record.milestones.map((m, i) => (
                  <span key={i} className="milestone-pill">
                    ⭐ {m}
                  </span>
                ))}
              </div>
            )}

            {record.favorite_opener && (
              <div className="friend-opener">
                <span className="opener-icon">♟</span>
                <span>
                  Loves opening <strong>{record.favorite_opener.move}</strong> ({record.favorite_opener.times}/{record.favorite_opener.of_games} games)
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="friend-no-battles">
            <span className="empty-swords">⚔️</span>
            <span>No battles recorded yet. Challenge them now to claim your first win!</span>
          </div>
        )}

        <div className="challenge-controls-panel">
          <div className="tc-select-wrap" ref={dropdownRef}>
            <label className="control-label">Time Control</label>
            <div className="custom-tc-dropdown">
              <button
                type="button"
                className={`custom-tc-trigger interactive ${isDropdownOpen ? 'active' : ''}`}
                disabled={busy || waiting}
                aria-haspopup="listbox"
                aria-expanded={isDropdownOpen}
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              >
                <span className="tc-trigger-icon">{selectedTc.icon}</span>
                <div className="tc-trigger-text">
                  <span className="tc-trigger-label">{selectedTc.label}</span>
                  <span className="tc-trigger-sublabel">{selectedTc.sublabel}</span>
                </div>
                <span className="tc-trigger-badge">{selectedTc.badge}</span>
                <span className={`tc-trigger-chevron ${isDropdownOpen ? 'open' : ''}`}>▾</span>
              </button>

              <AnimatePresence>
                {isDropdownOpen && (
                  <motion.div
                    className="custom-tc-menu"
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.14 }}
                    role="listbox"
                  >
                    {TC_OPTIONS.map((o, idx) => (
                      <button
                        key={idx}
                        type="button"
                        role="option"
                        aria-selected={selectedTcIndex === idx}
                        className={`custom-tc-item interactive ${selectedTcIndex === idx ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedTcIndex(idx);
                          setIsDropdownOpen(false);
                        }}
                      >
                        <span className="tc-item-icon">{o.icon}</span>
                        <div className="tc-item-details">
                          <span className="tc-item-title">{o.label}</span>
                          <span className="tc-item-subtitle">{o.sublabel}</span>
                        </div>
                        <span className="tc-item-badge">{o.badge}</span>
                        {selectedTcIndex === idx && <span className="tc-item-check">✓</span>}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="color-picker-wrap">
            <label className="control-label">Your Color</label>
            <div className="color-picker-chips">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy || waiting}
                  className={`color-chip-btn ${selectedColor === c.id ? 'active' : ''}`}
                  onClick={() => setSelectedColor(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {pausedMatches && pausedMatches.length > 0 && (
        <div className="friend-paused-section">
          <div className="friend-paused-header">
            <span className="friend-paused-icon">⏸</span>
            <span className="friend-paused-title">Paused Matches ({pausedMatches.length})</span>
          </div>
          <div className="friend-paused-list">
            {pausedMatches.map((pm) => (
              <div key={pm.game_id} className="friend-paused-item">
                <div className="friend-paused-info">
                  <div className="friend-paused-row">
                    <span className="friend-paused-tc">
                      ⏱ {tcLabel(pm.time_control_seconds, pm.increment_seconds)}
                    </span>
                    <span className="friend-paused-moves">
                      ♟ {pm.moves_count} {pm.moves_count === 1 ? 'move' : 'moves'}
                    </span>
                  </div>
                  <div className="friend-paused-row">
                    <span className="friend-paused-color">
                      You: {pm.my_color === 'white' ? 'White ⚪' : 'Black ⚫'}
                    </span>
                    <span className={`friend-paused-turn ${pm.is_my_turn ? 'turn-mine' : 'turn-theirs'}`}>
                      {pm.is_my_turn ? '• Your turn' : "• Opponent's turn"}
                    </span>
                  </div>
                </div>
                <div className="friend-paused-btns">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm interactive friend-paused-resume-btn"
                    disabled={busy}
                    onClick={() => onResumeGame ? onResumeGame(pm.game_id) : navigate(`/game/${pm.game_id}`)}
                  >
                    ▶ Resume
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm interactive friend-paused-resign-btn"
                    disabled={busy}
                    onClick={() => onResignPaused ? onResignPaused(pm.game_id) : null}
                  >
                    ✕ Resign
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="friend-actions">
        {waiting ? (
          <button
            className="btn-challenge-active interactive"
            disabled={busy}
            title="Challenge sent — click to cancel"
            onClick={handleChallengeClick}
          >
            {busy ? 'Cancelling...' : '⏳ Waiting for opponent · Cancel'}
          </button>
        ) : (
          <button
            className="btn-challenge-main interactive"
            disabled={busy}
            title={`Challenge ${friend.username} (${selectedTc.label})`}
            onClick={handleChallengeClick}
          >
            {busy ? 'Sending...' : `⚔️ Challenge ${friend.username}`}
          </button>
        )}

        <button
          type="button"
          className="btn-neon interactive"
          style={{
            width: '100%',
            marginTop: '8px',
            background: 'transparent',
            color: 'var(--royal-gold, #D4AF37)',
            borderColor: 'var(--royal-gold, #D4AF37)',
            padding: '8px 12px',
            fontSize: '0.82rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            opacity: (busy || waiting || importingPgn) ? 0.45 : 1,
            cursor: (busy || waiting || importingPgn) ? 'not-allowed' : 'pointer',
          }}
          disabled={busy || waiting || importingPgn}
          title={waiting ? 'Cannot import PGN while a challenge is pending' : `Import PGN and send challenge to resume with ${friend.username}`}
          onClick={() => pgnFileRef.current?.click()}
        >
          {importingPgn ? 'Importing PGN...' : '📥 Import PGN & Challenge'}
        </button>
        <input
          ref={pgnFileRef}
          type="file"
          accept=".pgn"
          style={{ display: 'none' }}
          onChange={handlePgnFileSelect}
        />

        <div className="friend-secondary-actions">
          {hasBattles && recentGames.length > 0 && (
            <button
              type="button"
              className="btn-history-toggle interactive"
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? 'Hide Match History ▲' : `Match History (${recentGames.length}) ▼`}
            </button>
          )}

          {confirmRemove ? (
            <div className="confirm-remove-group">
              <span className="confirm-remove-prompt">Remove {friend.username}?</span>
              <button
                className="btn-confirm-yes interactive"
                disabled={busy}
                onClick={() => {
                  setConfirmRemove(false);
                  onRemove?.(friend.username);
                }}
              >
                Yes, Remove
              </button>
              <button
                className="btn-confirm-no interactive"
                disabled={busy}
                onClick={() => setConfirmRemove(false)}
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-remove-ghost interactive"
              disabled={busy}
              title={`Remove ${friend.username}`}
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showHistory && recentGames.length > 0 && (
          <motion.div
            className="friend-history-drawer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="history-drawer-header">
              <span>Recent Battles</span>
            </div>
            <div className="history-games-list">
              {recentGames.map((g) => (
                <div key={g.id} className="history-game-row">
                  <span className={`game-result-tag result-${g.mine}`}>
                    {g.mine === 'win' ? '🏆 Won' : g.mine === 'loss' ? '💀 Lost' : '🤝 Draw'}
                  </span>
                  <span className="game-mode-tag">
                    {g.mode === 'friend' ? 'Friend Match' : g.mode}
                  </span>
                  <button
                    className="btn-review-link interactive"
                    onClick={() => navigate(`/review/${g.id}`)}
                  >
                    Review
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

