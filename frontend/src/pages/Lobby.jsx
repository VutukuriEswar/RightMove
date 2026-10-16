import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { gamesApi, createMatchmakingSocket } from '../lib/api';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.18 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 90 }
  }
};

const TIME_PRESETS = [
  { label: 'No Timer', tc: 0,    inc: 0 },
  { label: '1 min',   tc: 60,   inc: 0 },
  { label: '5 min',   tc: 300,  inc: 0 },
  { label: '10 min',  tc: 600,  inc: 0 },
  { label: '30 min',  tc: 1800, inc: 0 },
  { label: '1 hr',    tc: 3600, inc: 0 },
  { label: 'Custom',  tc: null, inc: 0 },
];

export default function Lobby() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  const [pendingGameType, setPendingGameType] = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const requestTimeControl = (gameType) => {
    setPendingGameType(gameType);
  };

  const selectTimeControl = async (preset) => {
    const gameType = pendingGameType;
    setPendingGameType(null);

    if (gameType === 'pass_and_play') {
      setLoading(true);
      setError(null);
      try {
        const { id } = await gamesApi.create({
          mode: 'pass_and_play',
          time_control_seconds: preset.tc,
          increment_seconds: preset.inc,
        });
        navigate(`/game/${id}`);
      } catch (err) {
        setError(err.message || 'Failed to start game');
        setLoading(false);
      }
      return;
    }

    const socket = createMatchmakingSocket(token, preset.tc, preset.inc);
    wsRef.current = socket;
    setSearching(true);
    setError(null);

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'paired') {
        socket.close();
        navigate(`/game/${msg.payload.game_id}`);
      } else if (msg.type === 'error') {
        setError(msg.payload.message);
        setSearching(false);
        socket.close();
      }
    };

    socket.onerror = () => {
      setError('Matchmaking connection failed');
      setSearching(false);
    };
  };

  const handleStartPlayGame = async () => {
    setLoading(true);
    setError(null);
    try {
      const paused = await gamesApi.pausedGames().catch(() => ({ games: [] }));
      if (paused.games && paused.games.length > 0) {
        navigate('/paused');
        return;
      }
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
      setLoading(false);
    }
  };

  const cancelSearch = () => {
    if (wsRef.current) wsRef.current.close();
    setSearching(false);
    wsRef.current = null;
  };

  return (
    <motion.div
      className="lobby-page page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="lobby-header"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="lobby-crest">♚</div>
        <h1>Choose Your Battle</h1>
        <p>Select the nature of your contest, noble player</p>
      </motion.div>

      {error && <div className="alert alert-error">{error}</div>}

      <motion.div
        className="lobby-grid"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >

        <motion.div variants={itemVariants} className="lobby-card glass-panel interactive" whileHover={{ scale: 1.03, translateY: -6 }}>
          <div className="lobby-card-icon">⚔️</div>
          <h2>Quick Match</h2>
          <p>Find an opponent online for a casual game.</p>

          {searching ? (
            <div className="searching-state">
              <span className="spinner" />
              <span>Seeking your challenger…</span>
              <button className="btn-neon interactive btn-abort" onClick={cancelSearch}>Withdraw</button>
            </div>
          ) : (
            <button
              className="btn-neon interactive"
              onClick={() => requestTimeControl('matchmaking')}
              disabled={loading}
            >
              Begin Match
            </button>
          )}
        </motion.div>

        <motion.div variants={itemVariants} className="lobby-card glass-panel interactive" whileHover={{ scale: 1.03, translateY: -6 }}>
          <div className="lobby-card-icon">🎓</div>
          <h2>Coach Mode</h2>
          <p>
            Play a guided game that makes you a better player — real-time advice,
            live parameters, candidate moves and a full report at the end.
            Your opponent, playing strength and color are chosen inside the game.
          </p>

          <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
            <button className="btn-neon interactive" onClick={handleStartPlayGame}
              disabled={loading || searching}>
              ▶ Play
            </button>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="lobby-card glass-panel interactive" whileHover={{ scale: 1.03, translateY: -6 }}>
          <div className="lobby-card-icon">🎮</div>
          <h2>Pass & Play</h2>
          <p>Two players sharing one board, as chess has always been played. No network required.</p>
          <button
            className="btn-neon interactive"
            onClick={() => requestTimeControl('pass_and_play')}
            disabled={loading || searching}
          >
            Begin Over the Board
          </button>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {pendingGameType && (
          <TimeControlModal
            title={pendingGameType === 'pass_and_play' ? 'Choose Your Time' : 'Choose Your Match Pace'}
            subtitle="Both players receive the same time. Pick a tempo, or play without a clock."
            onSelect={selectTimeControl}
            onClose={() => setPendingGameType(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function TimeControlModal({ title, subtitle, onSelect, onClose }) {
  const [customMinutes, setCustomMinutes] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const handlePreset = (p) => {
    if (p.tc === null) {
      setShowCustom(true);
    } else {
      onSelect(p);
    }
  };

  const handleCustomConfirm = () => {
    const mins = parseFloat(customMinutes);
    if (!mins || mins <= 0) return;
    onSelect({ label: `${customMinutes} min`, tc: Math.round(mins * 60), inc: 0 });
  };

  return (
    <motion.div
      className="tc-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="tc-modal"
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="tc-modal-crest">⏱</div>
        <h2>{title}</h2>
        <p>{subtitle}</p>

        <div className="tc-presets">
          {TIME_PRESETS.map(p => (
            <button
              key={p.label}
              className={`btn-neon interactive tc-preset${showCustom && p.tc === null ? ' tc-preset-active' : ''}`}
              onClick={() => handlePreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {showCustom && (
          <div className="tc-custom-row">
            <input
              className="tc-custom-input"
              type="number"
              min="1"
              max="180"
              placeholder="Minutes (e.g. 15)"
              value={customMinutes}
              onChange={e => setCustomMinutes(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCustomConfirm()}
              autoFocus
            />
            <button
              className="btn-neon interactive tc-custom-go"
              onClick={handleCustomConfirm}
              disabled={!customMinutes || parseFloat(customMinutes) <= 0}
            >
              ✓ Set
            </button>
          </div>
        )}

        <button className="btn-neon interactive tc-close" onClick={onClose}>
          Cancel
        </button>
      </motion.div>
    </motion.div>
  );
}
