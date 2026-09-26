import { useState, useCallback, useMemo, Fragment, Component } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Board2D from '../board/Board2D';
import { coachApi } from '../../lib/api';

const RANK_MEDALS = ['🥇', '🥈', '🥉'];
const MAX_COUNT = 20;
const MAX_CHAIN_PAIRS = 10;
const rangeFill = (v, min, max) => ({
  '--fill-pct': `${max > min ? Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) : 0}%`,
});
const USER_ARROW_COLOR = '#10b981';
const BOT_ARROW_COLOR = '#f59e0b';
const CANDIDATE_DEPTH = 18;

class LabViewBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="lab-crash" role="alert">
          <p>Something went wrong showing this view.</p>
          <p className="lab-crash-detail">{String(this.state.error?.message || '')}</p>
          <button
            className="btn-sm interactive"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            ← Back to candidates
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function fmtUserScore(c, userIsWhite) {
  if (c.is_mate) return c.mate_str || (userIsWhite ? '+M' : '-M');
  const v = userIsWhite ? c.score_white : -c.score_white;
  return `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}`;
}

function fmtUserWin(c, userIsWhite) {
  const w = userIsWhite ? c.win_prob : 1 - c.win_prob;
  return `${Math.round(w * 100)}%`;
}

function plainNote(text) {
  return String(text || '').replace(/\*\*/g, '');
}

export default function CandidateLab({ fen, playerColor = 'white', canPlay = false, canGenerate = true, onPlayMove }) {
  const userIsWhite = String(playerColor).toLowerCase() !== 'black';

  const [venue, setVenue] = useState('closed');
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [baseFen, setBaseFen] = useState(null);
  const [candidates, setCandidates] = useState([]);

  const [selectedRank, setSelectedRank] = useState(null);
  const [explain, setExplain] = useState(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const [explainError, setExplainError] = useState(null);

  const [showSimForm, setShowSimForm] = useState(false);
  const [simN, setSimN] = useState(4);
  const [simDepth, setSimDepth] = useState(12);
  const [simBusy, setSimBusy] = useState(false);
  const [simError, setSimError] = useState(null);
  const [chain, setChain] = useState(null);
  const [chainOrigin, setChainOrigin] = useState(null);
  const [labView, setLabView] = useState('candidates');

  const [closeArmed, setCloseArmed] = useState(false);

  const stale = !!baseFen && !!fen && baseFen !== fen;
  const selected = useMemo(
    () => candidates.find((c) => c.rank === selectedRank) || null,
    [candidates, selectedRank]
  );

  const clearAll = useCallback(() => {
    setCandidates([]);
    setBaseFen(null);
    setSelectedRank(null);
    setExplain(null);
    setExplainError(null);
    setShowSimForm(false);
    setSimN(4);
    setChain(null);
    setChainOrigin(null);
    setLabView('candidates');
    setSimError(null);
    setError(null);
    setCloseArmed(false);
  }, []);

  const generate = useCallback(async () => {
    if (!fen || busy || !canGenerate) return;
    setBusy(true);
    setError(null);
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Candidate generation timed out — the engine may be busy. Please try again.')),
          90000
        );
      });
      const data = await Promise.race([coachApi.candidates(fen, count, CANDIDATE_DEPTH), timeout]);
      if (!data || !Array.isArray(data.candidates) || data.candidates.length === 0) {
        throw new Error('No candidate moves returned.');
      }
      setCandidates(data.candidates);
      setBaseFen(data.fen || fen);
      setSelectedRank(null);
      setExplain(null);
      setExplainError(null);
      setShowSimForm(false);
      setChain(null);
      setChainOrigin(null);
      setLabView('candidates');
      setSimError(null);
      setVenue('open');
    } catch (e) {
      setError(e.message || 'Candidate generation failed');
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }, [fen, count, busy, canGenerate]);

  const selectCandidate = useCallback(async (cand) => {
    if (!cand) return;
    setSelectedRank(cand.rank);
    setLabView('candidates');
    setShowSimForm(false);
    setChain(null);
    setChainOrigin(null);
    setSimError(null);
    if (explain && explain._forUci === cand.move_uci && explain._forFen === baseFen) return;
    setExplain(null);
    setExplainError(null);
    setExplainBusy(true);
    try {
      const bestUci = candidates.length > 0 ? candidates[0].move_uci : null;
      const data = await coachApi.explain(baseFen, cand.move_uci, bestUci, cand.cp_delta || 0, null);
      if (data?.error) throw new Error(data.error);
      setExplain({ ...data, _forUci: cand.move_uci, _forFen: baseFen });
    } catch (e) {
      setExplainError(e.message || 'Explanation failed');
    } finally {
      setExplainBusy(false);
    }
  }, [baseFen, candidates]);

  const runDeepLine = useCallback(async () => {
    if (!selected || simBusy) return;
    setSimBusy(true);
    setSimError(null);
    try {
      const data = await coachApi.simulate(selected.fen_after || baseFen, null, simN, simDepth, playerColor);
      if (data?.error) throw new Error(data.error);
      if (!data || !Array.isArray(data.steps) || data.steps.length === 0) {
        throw new Error('Simulation returned no moves.');
      }
      setChain(data);
      setChainOrigin(selected.move_san);
      setLabView('chain');
    } catch (e) {
      setSimError(e.message || 'Simulation failed');
    } finally {
      setSimBusy(false);
    }
  }, [selected, simBusy, simN, simDepth, playerColor, baseFen]);

  const playSelected = useCallback(() => {
    if (!selected || !canPlay || stale) return;
    try {
      onPlayMove?.(selected.move_uci);
    } catch (_) {
      return;
    }
    clearAll();
    setVenue('closed');
  }, [selected, canPlay, stale, onPlayMove, clearAll]);

  const chainPairs = useMemo(() => {
    if (!chain || !Array.isArray(chain.steps)) return [];
    const pairs = [];
    for (let i = 0; i < chain.steps.length && pairs.length < MAX_CHAIN_PAIRS; i += 2) {
      pairs.push(chain.steps.slice(i, i + 2));
    }
    return pairs;
  }, [chain]);

  const pairFirstIsUser = chainPairs.length > 0 && chainPairs[0].length > 0
    ? !!chainPairs[0][0].is_user_step
    : true;

  return (
    <>
      <div className="coach-card card lab-entry">
        <h4 className="coach-card-title">🔬 Candidate Lab</h4>
        <p className="lab-entry-sub">Rank the best moves here — one board per candidate.</p>

        <label className="sim-slider">
          <span>Candidate moves</span>
          <input type="range" min="1" max={MAX_COUNT} value={count}
            style={rangeFill(count, 1, MAX_COUNT)}
            onChange={(e) => setCount(+e.target.value)} />
          <em>{count}</em>
        </label>

        {venue === 'minimized' ? (
          <button
            className="btn-neon interactive coach-action-btn sim-run"
            onClick={() => { setCloseArmed(false); setVenue('open'); }}
          >
            🔬 Reopen Lab
          </button>
        ) : (
          <button
            className="btn-neon interactive coach-action-btn sim-run"
            disabled={busy || !fen || !canGenerate}
            title={!canGenerate ? 'Available on your turn — ranks your moves only' : undefined}
            onClick={generate}
          >
            {busy ? 'Ranking…' : '🔬 Generate Candidates'}
          </button>
        )}
        {!canGenerate && (
          <p className="lab-entry-sub">Available on your turn — it ranks moves for your side only.</p>
        )}
        {venue === 'minimized' && candidates.length > 0 && (
          <p className="coach-chips-label" style={{ opacity: 0.75 }}>
            Lab minimized with {candidates.length} candidate{candidates.length === 1 ? '' : 's'} — reopen or generate fresh.
          </p>
        )}
        {error && venue !== 'open' && (
          <div className="alert alert-error" role="alert" style={{ marginTop: '8px', fontSize: '0.75rem' }}>
            {error}
          </div>
        )}
      </div>

      {venue === 'minimized' && createPortal(
        <motion.button
          className="lab-pill interactive"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => { setCloseArmed(false); setVenue('open'); }}
        >
          🔬 Candidate Lab ({candidates.length})
        </motion.button>,
        document.body
      )}

      {createPortal(
        <AnimatePresence>
          {venue === 'open' && (
            <motion.div
              key="lab-studio"
              className="lab-studio"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ type: 'spring', stiffness: 220, damping: 26 }}
            >
              <div className="lab-header">
                <div className="lab-title">
                  <span className="lab-crest">🔬</span>
                  <div>
                    <h2>Candidate Lab</h2>
                  </div>
                </div>
                <div className="lab-header-actions">
                  <button
                    className="lab-min interactive"
                    onClick={() => { setCloseArmed(false); setVenue('minimized'); }}
                    title="Minimize (keeps results)"
                  >
                    −
                  </button>
                  <div className="lab-close-wrap">
                    <button
                      className="lab-close interactive"
                      onClick={() => setCloseArmed((v) => !v)}
                      title="Close (discards results)"
                    >
                      ×
                    </button>
                    {closeArmed && (
                      <div className="lab-close-confirm" role="dialog" aria-label="Confirm discard">
                        <p>Discard the lab? You’ll need to regenerate.</p>
                        <div>
                          <button
                            className="btn-sm interactive"
                            onClick={() => { clearAll(); setVenue('closed'); }}
                          >
                            Yes, discard
                          </button>
                          <button
                            className="btn-sm interactive"
                            onClick={() => setCloseArmed(false)}
                          >
                            Keep
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {error && <div className="alert alert-error" style={{ margin: '10px 28px 0', fontSize: '0.75rem' }}>{error}</div>}
              {stale && (
                <div className="lab-stale">
                  The game moved on — these candidates are from an earlier position. Generate fresh or keep exploring.
                </div>
              )}

              <LabViewBoundary
                key={`${labView}:${selectedRank ?? 'none'}:${chain ? 'chain' : 'nocache'}`}
                onReset={() => {
                  setSelectedRank(null);
                  setChain(null);
                  setChainOrigin(null);
                  setShowSimForm(false);
                  setLabView('candidates');
                }}
              >
                {labView === 'chain' && chain ? (
                  <div className="lab-chainview">
                    <div className="lab-chainview-head">
                      <button
                        className="btn-sm interactive"
                        onClick={() => { setLabView('candidates'); setSelectedRank(null); }}
                      >
                        ← Back to candidates
                      </button>
                      <h3>Next moves from {chainOrigin}</h3>
                    </div>
                    <p className="lab-chain-legend">
                      <span className="lab-chain-legend-item">
                        <i className="lab-legend-dot" style={{ background: BOT_ARROW_COLOR }} />
                        Bot move{pairFirstIsUser ? ' · 2nd' : ' · 1st'}
                      </span>
                      <span className="lab-chain-legend-item">
                        <i className="lab-legend-dot" style={{ background: USER_ARROW_COLOR }} />
                        Your move{pairFirstIsUser ? ' · 1st' : ' · 2nd'}
                      </span>
                    </p>
                    {chain?.future_impact && (
                      <div className="lab-verdict card" style={{ margin: '0 0 12px', padding: '10px 14px' }}>
                        <h4 className="coach-card-title">
                          {chain.future_impact.favourable_to === 'user' ? '✅' : chain.future_impact.favourable_to === 'bot' ? '⚠️' : '➖'}{' '}
                          {chain.future_impact.favourable_label || chain.future_impact.benefit_verdict}
                        </h4>
                        <p className="coach-text">
                          Last position eval:{' '}
                          <strong>
                            {chain.future_impact.final_position_eval
                              ? `${(chain.future_impact.final_position_eval.net_score_centipawns / 100).toFixed(2)}`
                              : `${(chain.future_impact.final_eval ?? 0) >= 0 ? '+' : ''}${Number(chain.future_impact.final_eval ?? 0).toFixed(2)}`}
                          </strong>
                          {chain.future_impact.final_position_eval?.game_phase ? ` · ${chain.future_impact.final_position_eval.game_phase}` : ''}
                          {` · shift ${chain.future_impact.eval_shift >= 0 ? '+' : ''}${Number(chain.future_impact.eval_shift ?? 0).toFixed(2)}`}
                        </p>
                        {(chain.future_impact.why || []).map((w, i) => (
                          <p key={i} className="coach-text">• {w}</p>
                        ))}
                        {(chain.future_impact.overall_analysis_points || []).slice(0, 2).map((w, i) => (
                          <p key={`o${i}`} className="coach-text">• {String(w).replace(/\*\*/g, '')}</p>
                        ))}
                      </div>
                    )}
                    <div className="lab-chain-row">
                      {chainPairs.map((pair, i) => {
                        const last = pair[pair.length - 1];
                        const userPly = pair.find((s) => s.is_user_step) || null;
                        const focusPly = userPly || last;
                        return (
                          <Fragment key={i}>
                            <div className="lab-chain-card">
                              <div className="lab-card-rank">
                                <span className="lab-san">{pair.map((s) => s.move_san).join(', ')}</span>
                                <span className="lab-chain-sep-num" title={`Round ${i + 1}`}>{i + 1}</span>
                              </div>
                              <div className="lab-board">
                                <Board2D
                                  id={`lab-chain-${i}`}
                                  fen={last.fen_after}
                                  disabled
                                  framed={false}
                                  playerColor={playerColor}
                                  arrows={pair.map((s) => ({
                                    from: s.from_sq,
                                    to: s.to_sq,
                                    color: s.is_user_step ? USER_ARROW_COLOR : BOT_ARROW_COLOR,
                                  }))}
                                  lastMove={last.from_sq && last.to_sq
                                    ? { from: last.from_sq, to: last.to_sq }
                                    : null}
                                />
                              </div>
                          {focusPly?.explanation && (
                            <p className="lab-chain-why">
                              <strong>
                                {focusPly.is_user_step
                                  ? `Why play ${focusPly.move_san}:`
                                  : `Bot plays ${focusPly.move_san}:`}
                              </strong>{' '}
                              {plainNote(focusPly.explanation)}
                            </p>
                          )}
                            </div>
                            {i < chainPairs.length - 1 && (
                              <div className="lab-chain-sep" aria-hidden="true">
                                <span className="lab-chain-sep-arrow">⇒</span>
                              </div>
                            )}
                          </Fragment>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="lab-body">
                    {selected ? (
                      <div className="lab-focus">
                        <div className="lab-focus-board">
                          <div className="lab-card-rank">
                            <span className="lab-medal">{RANK_MEDALS[selected.rank - 1] || `#${selected.rank}`}</span>
                            <span className="lab-san">{selected.move_san}</span>
                            <span className="lab-quality">{selected.quality}</span>
                          </div>
                          <div className="lab-board">
                            <Board2D
                              id={`lab-focus-${selected.rank}`}
                              fen={selected.fen_after || baseFen}
                              disabled
                              framed={false}
                              playerColor={playerColor}
                              arrows={[{ from: selected.move_uci.slice(0, 2), to: selected.move_uci.slice(2, 4) }]}
                              lastMove={{ from: selected.move_uci.slice(0, 2), to: selected.move_uci.slice(2, 4) }}
                            />
                          </div>
                          <div className="lab-card-meta">
                            <span className="mono">{fmtUserScore(selected, userIsWhite)}</span>
                            <span className="mono">{fmtUserWin(selected, userIsWhite)}</span>
                            <span className="lab-delta">
                              {selected.rank === 1 ? 'engine top' : `−${((selected.cp_delta || 0) / 100).toFixed(2)} vs #1 (${candidates[0]?.move_san})`}
                            </span>
                          </div>
                        </div>
                        <div className="lab-focus-info" role="dialog" aria-label="Candidate details">
                          <button
                            className="lab-focus-close interactive"
                            onClick={() => setSelectedRank(null)}
                            aria-label="Close details"
                          >
                            ×
                          </button>
                          <div className="lab-detail-head">
                            <span className="lab-medal">{RANK_MEDALS[selected.rank - 1] || `#${selected.rank}`}</span>
                            <strong>{selected.move_san}</strong>
                            <span className="lab-quality">{selected.quality}</span>
                            <span className="mono">{fmtUserScore(selected, userIsWhite)} · {fmtUserWin(selected, userIsWhite)}</span>
                          </div>
                          <p className="lab-rank-why">
                            {selected.rank === 1
                              ? `Rank #1 — Stockfish's top choice at max depth (no centipawns conceded).`
                              : `Ranked #${selected.rank} — concedes ${((selected.cp_delta || 0) / 100).toFixed(2)} pawns vs #1 (${candidates[0]?.move_san}).`}
                          </p>

                          {explainBusy && <p className="lab-empty">Explaining {selected.move_san}…</p>}
                          {explainError && <div className="alert alert-error" style={{ fontSize: '0.75rem' }}>{explainError}</div>}
                          {explain && !explainBusy && (
                            <>
                              <div className="lab-pros-cons">
                                <h5>✅ Advantages</h5>
                                <p><strong>{explain.thing_1?.title || 'Strengths'}</strong></p>
                                <p>{explain.thing_1?.summary}</p>
                                {(explain.thing_1?.reasons || []).map((r, i) => <p key={i}>• {r}</p>)}
                              </div>
                              <div className="lab-pros-cons cons">
                                <h5>⚠️ Disadvantages</h5>
                                <p><strong>{explain.thing_2?.title || 'Weaknesses'}</strong></p>
                                <p>{explain.thing_2?.summary}</p>
                                {(explain.thing_2?.reasons_to_avoid || []).map((r, i) => <p key={i}>• {r}</p>)}
                              </div>
                            </>
                          )}

                          <div className="lab-detail-actions">
                            <button
                              className="btn-neon interactive"
                              disabled={!canPlay || stale}
                              title={!canPlay ? 'Available on your turn in a live game' : stale ? 'Position changed — regenerate first' : `Play ${selected.move_san}`}
                              onClick={playSelected}
                            >
                              ▶ Play on board
                            </button>
                            <button
                              className="btn-neon interactive"
                              style={{ background: 'transparent' }}
                              onClick={() => { setShowSimForm((v) => !v); setChain(null); setSimError(null); }}
                            >
                              🔭 Simulate further
                            </button>
                          </div>

                          {showSimForm && (
                            <div className="lab-simform">
                              <label className="sim-slider">
                                <span>Full moves to simulate (you + bot)</span>
                                <input type="range" min="1" max="10" value={simN}
                                  style={rangeFill(simN, 1, 10)}
                                  onChange={(e) => setSimN(+e.target.value)} />
                                <em>{simN}</em>
                              </label>
                              <label className="sim-slider">
                                <span>Depth</span>
                                <input type="range" min="8" max="20" value={simDepth}
                                  style={rangeFill(simDepth, 8, 20)}
                                  onChange={(e) => setSimDepth(+e.target.value)} />
                                <em>{simDepth}</em>
                              </label>
                              <button
                                className="btn-neon interactive"
                                disabled={simBusy}
                                onClick={runDeepLine}
                              >
                                {simBusy ? 'Simulating…' : `Simulate ${simN} from ${selected.move_san}`}
                              </button>
                              {simError && <div className="alert alert-error" style={{ fontSize: '0.75rem' }}>{simError}</div>}
                            </div>
                          )}

                        </div>
                      </div>
                    ) : (
                      <div className="lab-grid">
                        {candidates.map((c) => (
                          <button
                            key={c.move_uci}
                            className="lab-card interactive"
                            onClick={() => selectCandidate(c)}
                            aria-label={`Candidate ${c.rank}: ${c.move_san}`}
                          >
                            <div className="lab-card-rank">
                              <span className="lab-medal">{RANK_MEDALS[c.rank - 1] || `#${c.rank}`}</span>
                              <span className="lab-san">{c.move_san}</span>
                              <span className="lab-quality">{c.quality}</span>
                            </div>
                            <div className="lab-board">
                              <Board2D
                                id={`lab-cand-${c.rank}`}
                                fen={c.fen_after || baseFen}
                                disabled
                                framed={false}
                                playerColor={playerColor}
                                arrows={[{ from: c.move_uci.slice(0, 2), to: c.move_uci.slice(2, 4) }]}
                                lastMove={{ from: c.move_uci.slice(0, 2), to: c.move_uci.slice(2, 4) }}
                              />
                            </div>
                            <div className="lab-card-meta">
                              <span className="mono">{fmtUserScore(c, userIsWhite)}</span>
                              <span className="mono">{fmtUserWin(c, userIsWhite)}</span>
                              <span className="lab-delta">
                                {c.rank === 1 ? 'engine top' : `−${((c.cp_delta || 0) / 100).toFixed(2)} vs #1`}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </LabViewBoundary>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
