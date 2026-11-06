import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { gamesApi } from '../../lib/api';
import WdlBar from './WdlBar';
import ParametersPanel from './ParametersPanel';

export default function PlaySidebar({ fen, onBotFirst, settingsLocked = false }) {
  const mode = useGameStore((s) => s.mode);
  const moves = useGameStore((s) => s.moves);
  const result = useGameStore((s) => s.result);
  const playerColor = useGameStore((s) => s.playerColor);
  const botEngine = useGameStore((s) => s.botEngine);
  const botDepth = useGameStore((s) => s.botDepth);
  const maiaElo = useGameStore((s) => s.maiaElo);
  const gameId = useGameStore((s) => s.gameId);
  const flipBoard = useGameStore((s) => s.flipBoard);

  const [probs, setProbs] = useState(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapError, setSwapError] = useState(null);
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgError, setCfgError] = useState(null);
  const [showWinChances, setShowWinChances] = useState(true);
  const [showSetup, setShowSetup] = useState(true);

  const started = moves.length > 0;
  const isBotGame = mode === 'bot';
  const flipLocked = started || !!result;
  const locked = started || !!settingsLocked || !!result;
  const userIsWhite = playerColor !== 'black';
  const botIsWhite = !userIsWhite;

  const norm = (v, fb) => {
    if (!Number.isFinite(v)) return fb;
    return v <= 1.2 ? v * 100 : v;
  };
  let userWin = 50; let draw = 30; let botWin = 20;
  if (probs) {
    draw = norm(probs.draw, draw);
    if (userIsWhite) { userWin = norm(probs.white, userWin); botWin = norm(probs.black, botWin); }
    else { userWin = norm(probs.black, userWin); botWin = norm(probs.white, botWin); }
  }

  const handleFlip = async () => {
    if (flipLocked) return;
    setSwapError(null);
    if (isBotGame && !started && !result && gameId) {
      setSwapBusy(true);
      try {
        const next = userIsWhite ? 'black' : 'white';
        await gamesApi.chooseColor(gameId, next);
        useGameStore.setState({ playerColor: next, boardFlipped: false });
      } catch (e) {
        setSwapError(e.message || 'Swap failed');
      } finally {
        setSwapBusy(false);
      }
      return;
    }
    flipBoard();
  };

  const handleEngine = async (engine) => {
    if (!gameId || locked || cfgBusy || engine === botEngine) return;
    setCfgBusy(true); setCfgError(null);
    try {
      const payload = engine === 'maia3'
        ? { bot_engine: 'maia3', maia_elo: maiaElo ?? 1500 }
        : { bot_engine: 'stockfish', bot_depth: botDepth ?? 10 };
      const updated = await gamesApi.updateBotConfig(gameId, payload);
      useGameStore.setState({
        botEngine: updated.bot_engine ?? engine,
        botDepth: updated.bot_depth ?? null,
        maiaElo: updated.maia_elo ?? null,
      });
    } catch (e) {
      setCfgError(e.message || 'Engine change failed');
    } finally {
      setCfgBusy(false);
    }
  };

  const handleDifficulty = async (value) => {
    if (!gameId || locked || cfgBusy) return;
    setCfgBusy(true); setCfgError(null);
    try {
      const payload = botEngine === 'maia3'
        ? { bot_engine: 'maia3', maia_elo: value }
        : { bot_engine: 'stockfish', bot_depth: value };
      const updated = await gamesApi.updateBotConfig(gameId, payload);
      useGameStore.setState({
        botEngine: updated.bot_engine ?? botEngine,
        botDepth: updated.bot_depth ?? null,
        maiaElo: updated.maia_elo ?? null,
      });
    } catch (e) {
      setCfgError(e.message || 'Difficulty change failed');
    } finally {
      setCfgBusy(false);
    }
  };

  const handleColor = async (color) => {
    if (!gameId || locked || cfgBusy || color === playerColor) return;
    setSwapBusy(true); setSwapError(null);
    try {
      await gamesApi.chooseColor(gameId, color);
      useGameStore.setState({ playerColor: color, boardFlipped: false });
    } catch (e) {
      setSwapError(e.message || 'Swap failed');
    } finally {
      setSwapBusy(false);
    }
  };

  const showBotFirst = isBotGame && botIsWhite && !locked && !result;

  return (
    <div className="play-sidebar">
      <div className="card play-card">
        <button
          type="button"
          className={`params-toggle interactive ${showWinChances ? 'open' : ''}`}
          onClick={() => setShowWinChances((v) => !v)}
          aria-expanded={showWinChances}
        >
          <span>🏆 Win chances</span>
          <span className="params-chevron">{showWinChances ? '▾' : '▸'}</span>
        </button>
        {showWinChances && (
          <div style={{ marginTop: '8px' }}>
            <WdlBar userWin={userWin} draw={draw} botWin={botWin} />
          </div>
        )}
      </div>

      <div className="card play-card">
        <button
          type="button"
          className={`params-toggle interactive ${showSetup ? 'open' : ''}`}
          onClick={() => setShowSetup((v) => !v)}
          aria-expanded={showSetup}
        >
          <span>⚙️ Setup</span>
          <span className="params-chevron">{showSetup ? '▾' : '▸'}</span>
        </button>
        {showSetup && (
          <div style={{ marginTop: '8px' }}>
            {!isBotGame ? (
              <div className="play-setup-edit">
                <div className="play-setup-row">
                  <span>Mode</span>
                  <strong style={{ textTransform: 'capitalize' }}>{mode?.replace(/_/g, ' ') || 'Match'}</strong>
                </div>
              </div>
            ) : !locked ? (
              <div className="play-setup-edit">
                <div className="play-setup-engines">
                  {[
                    { value: 'stockfish', label: 'Stockfish' },
                    { value: 'maia3', label: 'Maia' },
                  ].map((e) => (
                    <button
                      key={e.value}
                      type="button"
                      className={`btn-sm interactive ${botEngine === e.value ? 'active' : ''}`}
                      onClick={() => handleEngine(e.value)}
                      disabled={cfgBusy || swapBusy}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
                {botEngine === 'maia3' ? (
                  <label className="play-setup-slider">
                    <span>Difficulty — Maia rating</span>
                    <strong>{maiaElo ?? 1500}</strong>
                    <input
                      type="range" min="1100" max="2000" step="50"
                      value={maiaElo ?? 1500}
                      style={{ '--fill-pct': `${(((maiaElo ?? 1500) - 1100) / 900) * 100}%` }}
                      onChange={(e) => handleDifficulty(Number(e.target.value))}
                      disabled={cfgBusy}
                    />
                  </label>
                ) : (
                  <label className="play-setup-slider">
                    <span>Difficulty — Stockfish depth</span>
                    <strong>{botDepth ?? 10}</strong>
                    <input
                      type="range" min="1" max="20"
                      value={botDepth ?? 10}
                      style={{ '--fill-pct': `${(((botDepth ?? 10) - 1) / 19) * 100}%` }}
                      onChange={(e) => handleDifficulty(Number(e.target.value))}
                      disabled={cfgBusy}
                    />
                  </label>
                )}
                <div className="play-setup-colors">
                  {['white', 'black'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`btn-sm interactive ${playerColor === c ? 'active' : ''}`}
                      onClick={() => handleColor(c)}
                      disabled={cfgBusy || swapBusy}
                      style={{ textTransform: 'capitalize' }}
                    >
                      {c === 'white' ? '♔ White' : '♚ Black'}
                    </button>
                  ))}
                </div>
                {(cfgError || swapError) && (
                  <p className="coach-text" style={{ color: 'var(--danger-t)' }}>{cfgError || swapError}</p>
                )}
                <p className="coach-text">Choose engine, strength and your color — locked once the match starts.</p>
              </div>
            ) : (
              <>
                <div className="play-setup-row">
                  <span>Engine</span>
                  <strong>{botEngine === 'maia3' ? 'Maia' : 'Stockfish'}</strong>
                </div>
                <div className="play-setup-row">
                  <span>Difficulty</span>
                  <strong>{botEngine === 'maia3' ? `Rating ${maiaElo ?? '—'}` : `Depth ${botDepth ?? '—'}`}</strong>
                </div>
                <div className="play-setup-row">
                  <span>You play</span>
                  <strong style={{ textTransform: 'capitalize' }}>{playerColor}</strong>
                </div>
                <p className="coach-text">🔒 Locked — settings can't change mid-game.</p>
              </>
            )}
          </div>
        )}
      </div>

      {showBotFirst && (
        <div className="card play-card">
          <div className="play-btn-grid">
            <button className="btn-sm interactive" onClick={onBotFirst}>
              🤖 Bot starts
            </button>
          </div>
        </div>
      )}

      <ParametersPanel fen={fen} playerColor={playerColor} onProbs={setProbs} />
    </div>
  );
}
