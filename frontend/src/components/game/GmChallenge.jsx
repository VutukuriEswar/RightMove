import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chess } from 'chess.js';
import Board2D from '../board/Board2D';
import { coachApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

const TIER_META = {
  'gm-instinct': { badge: '🏆 Pure GM Instinct', cls: 'gm-tier-instinct' },
  grandmaster: { badge: '♞ Grandmaster Thinking', cls: 'gm-tier-grandmaster' },
  'off-book': { badge: '🔍 Off the GM book', cls: 'gm-tier-offbook' },
};

function fenAfterMove(fen, uci) {
  try {
    const c = new Chess(fen);
    const move = c.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    if (!move) return null;
    return c.fen();
  } catch (_) {
    return null;
  }
}

export default function GmChallenge() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState(null);
  const [locked, setLocked] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);

  const [challenge, setChallenge] = useState(null);
  const [fetchBusy, setFetchBusy] = useState(false);
  const [playedUci, setPlayedUci] = useState(null);
  const [playedFen, setPlayedFen] = useState(null);
  const [score, setScore] = useState(null);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [error, setError] = useState(null);
  const [streak, setStreak] = useState(0);
  const reqSeq = useRef(0);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const data = await coachApi.gmModels();
      const list = data.models || [];
      setModels(list);
      if (!list.length) {
        setLocked(true);
        setModelId(null);
      } else {
        setLocked(false);
        setModelId((cur) => (list.some((m) => m.model_id === cur) ? cur : list[0].model_id));
      }
    } catch (e) {
      setLocked(true);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const fetchChallenge = useCallback(async (mid) => {
    const seq = ++reqSeq.current;
    setFetchBusy(true);
    setError(null);
    setScore(null);
    setPlayedUci(null);
    setPlayedFen(null);
    try {
      const data = await coachApi.gmChallenge(mid);
      if (seq !== reqSeq.current) return;
      setChallenge(data);
      setLocked(false);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      if (/locked|publish|forge|404|403/i.test(e.message || '')) setLocked(true);
      else setError(e.message || 'Could not draw a position');
    } finally {
      if (seq === reqSeq.current) setFetchBusy(false);
    }
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  useEffect(() => {
    if (!loadingModels && !locked && modelId !== undefined) fetchChallenge(modelId);
  }, [loadingModels, locked, modelId]);

  const handleMove = async (uci) => {
    if (!challenge || scoreBusy || score) return;
    const preview = fenAfterMove(challenge.fen, uci);
    setPlayedUci(uci);
    if (preview) setPlayedFen(preview);
    setScoreBusy(true);
    setError(null);
    try {
      const res = await coachApi.gmScore(challenge.fen, uci, modelId);
      setScore(res);
      if (res.tier === 'gm-instinct' || res.tier === 'grandmaster') {
        setStreak((s) => s + 1);
      } else {
        setStreak(0);
      }
    } catch (e) {
      setError(e.message || 'Scoring failed');
      setPlayedUci(null);
      setPlayedFen(null);
    } finally {
      setScoreBusy(false);
    }
  };

  const nextPosition = () => fetchChallenge(modelId);

  if (loadingModels) {
    return <div className="admin-loading"><span className="spinner" /> Consulting the grandmasters…</div>;
  }

  if (locked) {
    return (
      <div className="gm-locked">
        <div className="gm-locked-icon">🔒</div>
        <h3>The GM vault is still sealed</h3>
        <p>
          {isAdmin
            ? 'Train a model in The Forge first to unlock this — then publish it so players can challenge it too.'
            : 'No grandmaster brain has been published yet. Check back once the coaches forge one.'}
        </p>
        {isAdmin && (
          <Link className="btn-neon interactive" to="/admin/training">🧠 Open The Forge</Link>
        )}
      </div>
    );
  }

  const tier = score ? TIER_META[score.tier] || TIER_META['off-book'] : null;
  const shownUci = score?.user_move_uci || playedUci;
  const lastMove = shownUci
    ? { from: shownUci.slice(0, 2), to: shownUci.slice(2, 4) }
    : null;
  const boardDisabled = fetchBusy || scoreBusy || !!score;

  return (
    <div>
      <div className="gm-toolbar">
        <label className="gm-modelpick">
          <span>🧠 GM brain</span>
          <select
            className="interactive"
            value={modelId || ''}
            onChange={(e) => setModelId(e.target.value || null)}
            disabled={fetchBusy}
          >
            {models.map((m) => (
              <option key={m.model_id} value={m.model_id}>
                {m.name || m.model_id}{m.published ? '' : ' (draft)'}
              </option>
            ))}
          </select>
        </label>
        {streak > 1 && <span className="gm-streak">🔥 {streak} GM-level moves in a row</span>}
        <button className="btn-neon interactive" onClick={nextPosition} disabled={fetchBusy}>
          {fetchBusy ? 'Drawing…' : '⏭ Next Position'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {challenge && (
        <div className="gm-split">
          <div className="gm-board">
            <Board2D
              id="gmChallengeBoard"
              fen={playedFen || challenge.fen}
              playerColor={challenge.turn}
              onMove={handleMove}
              disabled={boardDisabled}
              lastMove={lastMove}
            />
            <div className="gm-game-src">
              ♞ {challenge.game.white} vs {challenge.game.black}
              {challenge.game.event ? ` · ${challenge.game.event}` : ''}
              {` · move ${Math.ceil(challenge.ply / 2)} · ${challenge.turn} to move`}
            </div>
            {scoreBusy && <div className="admin-loading"><span className="spinner" /> The GM is judging…</div>}
          </div>

          <div className="gm-info">
            {!score ? (
              <>
                <h4 className="lab-h">Your move</h4>
                <p className="review-report-text">
                  Drag a piece (or tap twice) to play what a grandmaster would play.
                  Instant verdict, no mercy.
                </p>
              </>
            ) : (
              <>
                <div className="gm-score-hero">
                  <span className={`gm-score-num tier-${score.tier}`}>{Math.round(score.score_pct)}%</span>
                  <div>
                    <div className={`gm-tier-badge ${tier.cls}`}>{tier.badge}</div>
                    <div className="gm-headline">{score.headline}</div>
                  </div>
                </div>
                <div className="stat-chips">
                  <span className="stat-chip">You played {score.user_move_san} ({score.user_prob_pct}%)</span>
                  <span className="stat-chip">GM: {score.gm_best_san} ({score.gm_confidence}%)</span>
                </div>

                <h4 className="lab-h">Position value</h4>
                <p className="review-report-text">
                  {score.position_label}{' '}
                  <span className="gm-eval">Stockfish {score.eval_white >= 0 ? '+' : ''}{score.eval_white.toFixed(2)}</span>
                </p>

                <h4 className="lab-h">Top 3 GM moves</h4>
                {(score.top_moves || []).map((m, i) => (
                  <div key={m.move_uci} className="cand-row">
                    <span className="cand-rank">#{i + 1}</span>
                    <strong>{m.move_san}</strong>
                    <span className="cand-note">{m.confidence_pct}% confidence</span>
                    <div className="gm-conf-bar"><div style={{ width: `${Math.min(100, m.confidence_pct)}%` }} /></div>
                  </div>
                ))}

                <button className="btn-neon interactive learn-cta" onClick={nextPosition} disabled={fetchBusy}>
                  ⏭ Next Position
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
