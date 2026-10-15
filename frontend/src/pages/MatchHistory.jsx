import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { listSavedGames, deleteGameLog, buildShareUrl, copyTextToClipboard } from '../lib/chessUtils';
import { gamesApi } from '../lib/api';

const RESULT_LABEL = { white: 'White Won', black: 'Black Won', draw: 'Draw', aborted: 'Aborted', null: 'Unknown' };
const RESULT_CLASS = { white: 'result-win', black: 'result-loss', draw: 'result-draw', aborted: 'result-draw' };
const MODE_LABEL   = { bot: 'vs Computer', pass_and_play: 'Pass & Play', casual: 'Casual', friend: 'vs Friend', random: 'Quick Match' };

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

  const reload = useCallback(async () => {
    setLoading(true);
    let server = null;
    try {
      const data = await gamesApi.history(100, 0);
      server = data.games || [];
    } catch (_) {
      server = null;
    }
    let local = [];
    try {
      local = await listSavedGames();
    } catch (_) {
      local = [];
    }
    const byId = new Map();
    (local || []).forEach(g => { byId.set(g.game_id, g); });
    let merged;
    if (server === null) {
      merged = (local || []).map(g => ({
        game_id: g.game_id,
        result: g.result,
        opponent: g.opponent,
        mode: g.mode,
        moves: g.moves,
        movesCount: g.moves?.length ?? 0,
        saved_at: g.saved_at,
        server: false,
        local: true,
      }));
    } else {
      merged = server.map(g => {
        const l = byId.get(g.id);
        byId.delete(g.id);
        return {
          game_id: g.id,
          result: g.result,
          opponent: g.opponent,
          mode: g.mode,
          moves: l?.moves || null,
          movesCount: g.moves_count ?? l?.moves?.length ?? 0,
          saved_at: g.started_at,
          server: true,
          local: !!l,
        };
      });
      byId.forEach(g => {
        if (g.mode === 'pass_and_play') {
          merged.push({
            game_id: g.game_id,
            result: g.result,
            opponent: g.opponent,
            mode: g.mode,
            moves: g.moves,
            movesCount: g.moves?.length ?? 0,
            saved_at: g.saved_at,
            server: false,
            local: true,
          });
        }
      });
      merged.sort((a, b) => new Date(b.saved_at || 0) - new Date(a.saved_at || 0));
    }
    setGames(merged);
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleDelete = async (gameId) => {
    await deleteGameLog(gameId);
    setGames(prev => {
      const next = prev.map(g => (g.game_id === gameId ? { ...g, moves: null, local: false } : g));
      return next.filter(g => g.server || g.local);
    });
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
        <p className="history-sub">Synced from your account, plus this device's over-the-board games.</p>
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
              <span className="history-moves">{g.movesCount ?? 0} moves</span>
              <span className="history-date">{formatDate(g.saved_at)}</span>
            </div>

            <div className="history-card-actions">
              <button className="hist-btn hist-btn-review" onClick={() => navigate(`/review/${g.game_id}`)}>
                Review
              </button>
              {g.moves?.length > 0 && (
                <button
                  className="hist-btn hist-btn-share"
                  onClick={() => handleShare(g)}
                  title="Copy shareable link"
                >
                  {copied === g.game_id ? '✓ Copied!' : '⇪ Share'}
                </button>
              )}
              {g.local && (
                <button className="hist-btn hist-btn-delete" onClick={() => handleDelete(g.game_id)} title="Delete from this device">
                  🗑
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
