import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { gamesApi } from '../lib/api';

function engineLabel(g) {
  if (g.bot_engine === 'maia3') return `Maia ${g.maia_elo ?? ''}`.trim();
  return `Stockfish ${g.bot_depth != null ? `depth ${g.bot_depth}` : ''}`.trim();
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function PausedGames() {
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [starting, setStarting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await gamesApi.pausedGames();
      setGames(data.games || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleResume = async (gameId) => {
    setBusyId(gameId);
    setError(null);
    try {
      await gamesApi.resumeGame(gameId);
      navigate(`/game/${gameId}`);
    } catch (err) {
      setError(err.message);
      setBusyId(null);
    }
  };

  const handleResign = async (gameId) => {
    setBusyId(gameId);
    setError(null);
    try {
      await gamesApi.resignPaused(gameId);
      setConfirmId(null);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleNewGame = async () => {
    setStarting(true);
    setError(null);
    try {
      const { id } = await gamesApi.create({
        mode: 'bot',
        bot_engine: 'stockfish',
        bot_depth: 10,
        player_color: 'white',
        time_control_seconds: 0,
        training_mode: true,
      });
      navigate(`/game/${id}`);
    } catch (err) {
      setError(err.message || 'Failed to start game');
      setStarting(false);
    }
  };

  return (
    <div className="history-page page">
      <div className="history-header">
        <h1 className="history-title">Paused Games</h1>
        <p className="history-sub">Coach battles waiting for you — resume any time.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="spinner-large" />}

      {!loading && (
        <button className="btn btn-primary" style={{ marginBottom: '16px' }} disabled={starting} onClick={handleNewGame}>
          {starting ? 'Starting...' : '+ Start new game'}
        </button>
      )}

      {!loading && games.length === 0 && (
        <div className="history-empty">
          <span className="history-empty-icon">⏸</span>
          <p>No paused games. Pause a coach game any time and it will wait here.</p>
          <p style={{ marginTop: '12px' }}>
            <Link to="/lobby" className="btn btn-secondary">Back to lobby</Link>
          </p>
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
              <span className="history-result result-draw">
                Paused · {g.player_color === 'black' ? 'Black' : 'White'}
              </span>
              <span className="history-opponent">vs Coach ({engineLabel(g)})</span>
              <span className="history-mode">{g.moves_count ?? 0} moves played</span>
            </div>

            <div className="history-card-meta">
              <span className="history-moves">{g.training_mode ? 'Training' : 'Casual'}</span>
              <span className="history-date">{formatDate(g.paused_at)}</span>
            </div>

            <div className="history-card-actions">
              <button
                className="hist-btn hist-btn-review"
                disabled={busyId === g.game_id}
                onClick={() => handleResume(g.game_id)}
              >
                {busyId === g.game_id ? '...' : '▶ Resume'}
              </button>
              {confirmId === g.game_id ? (
                <>
                  <button
                    className="hist-btn hist-btn-delete"
                    disabled={busyId === g.game_id}
                    onClick={() => handleResign(g.game_id)}
                  >
                    Confirm
                  </button>
                  <button
                    className="hist-btn hist-btn-share"
                    disabled={busyId === g.game_id}
                    onClick={() => setConfirmId(null)}
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  className="hist-btn hist-btn-delete"
                  disabled={busyId === g.game_id}
                  onClick={() => setConfirmId(g.game_id)}
                  title="Resign — counts as a completed loss"
                >
                  Resign
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
