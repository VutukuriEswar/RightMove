import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { listSavedGames, deleteGameLog, buildShareUrl, copyTextToClipboard } from '../lib/chessUtils';

const RESULT_LABEL = { white: 'White Won', black: 'Black Won', draw: 'Draw', null: 'Unknown' };
const RESULT_CLASS = { white: 'result-win', black: 'result-loss', draw: 'result-draw' };
const MODE_LABEL   = { bot: 'vs Computer', pass_and_play: 'Pass & Play', casual: 'Casual' };

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function MatchHistory() {
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);
  const [shareFailed, setShareFailed] = useState(null);

  const reload = useCallback(() => {
    listSavedGames().then(list => {
      setGames([...list].sort((a, b) => b.saved_at - a.saved_at));
      setLoading(false);
    });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleDelete = async (gameId) => {
    await deleteGameLog(gameId);
    setGames(prev => prev.filter(g => g.game_id !== gameId));
  };

  const handleShare = async (game) => {
    setShareFailed(null);
    let url;
    try {
      url = buildShareUrl(game);
    } catch (e) {
      setShareFailed({ id: game.game_id, message: 'Could not build a share link for this game.' });
      return;
    }
    const ok = await copyTextToClipboard(url);
    if (ok) {
      setCopied(game.game_id);
      setTimeout(() => setCopied(null), 2000);
    } else {

      setShareFailed({ id: game.game_id, message: 'Automatic copy was blocked — copy the link below manually.', url });
    }
  };

  const dismissShareFailed = () => setShareFailed(null);

  return (
    <div className="history-page page">
      <div className="history-header">
        <h1 className="history-title">Match History</h1>
        <p className="history-sub">All your saved games — stored locally on this device.</p>
      </div>

      {loading && <div className="spinner-large" />}

      {!loading && games.length === 0 && (
        <div className="history-empty">
          <span className="history-empty-icon">♟</span>
          <p>No saved matches yet. Play a game to see it here!</p>
          <Link to="/lobby" className="btn btn-primary" style={{ marginTop: '16px' }}>Play Now</Link>
        </div>
      )}

      {shareFailed && (
        <div className="alert alert-error" style={{ marginBottom: '12px' }}>
          <div>{shareFailed.message}</div>
          {shareFailed.url && (
            <input
              readOnly
              value={shareFailed.url}
              onFocus={(e) => e.target.select()}
              style={{ width: '100%', marginTop: '8px', fontSize: '0.72rem' }}
            />
          )}
          <button className="btn-sm interactive" style={{ marginTop: '8px' }} onClick={dismissShareFailed}>
            Dismiss
          </button>
        </div>
      )}

      <AnimatePresence>
        {games.map((g, i) => (
          <motion.div
            key={g.game_id}
            className="history-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ delay: i * 0.04 }}
          >
            <div className="history-card-left">
              <span className={`history-result ${RESULT_CLASS[g.result] || ''}`}>
                {RESULT_LABEL[g.result] || 'Unknown'}
              </span>
              <span className="history-opponent">vs {g.opponent || 'Unknown'}</span>
              <span className="history-mode">{MODE_LABEL[g.mode] || g.mode || '—'}</span>
            </div>

            <div className="history-card-meta">
              <span className="history-moves">{g.moves?.length ?? 0} moves</span>
              <span className="history-date">{formatDate(g.saved_at)}</span>
            </div>

            <div className="history-card-actions">
              <button className="hist-btn hist-btn-review" onClick={() => navigate(`/review/${g.game_id}`)}>
                Review
              </button>
              <button
                className="hist-btn hist-btn-share"
                onClick={() => handleShare(g)}
                title="Copy shareable link"
              >
                {copied === g.game_id ? '✓ Copied!' : '⇪ Share'}
              </button>
              <button className="hist-btn hist-btn-delete" onClick={() => handleDelete(g.game_id)} title="Delete from this device">
                🗑
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
