import { useState, useEffect, useCallback, useMemo, Fragment, Component } from 'react';
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
const CANDIDATE_DEPTH = 20;

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

function evalScoreClass(c, userIsWhite) {
  if (c.is_mate) {
    return c.mate_str?.startsWith('-') ? 'is-negative' : 'is-positive';
  }
  const v = userIsWhite ? c.score_white : -c.score_white;
  return v >= 0 ? 'is-positive' : 'is-negative';
}

function fmtUserWin(c, userIsWhite) {
  const w = userIsWhite ? c.win_prob : 1 - c.win_prob;
  return `${Math.round(w * 100)}%`;
}

function renderText(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    return val.text || val.summary || val.title || val.message || '';
  }
  return String(val);
}

function plainNote(text) {
  if (typeof text === 'object' && text !== null) {
    text = text.text || text.summary || text.explanation || text.title || '';
  }
  return String(text || '').replace(/\*\*/g, '');
}

function qualityTone(quality) {
  const q = String(quality || '').toLowerCase();
  if (q.includes('best') || q.includes('excellent') || q.includes('brilliant')) return 'best';
  if (q.includes('good') || q.includes('solid') || q.includes('great')) return 'good';
  if (q.includes('inacc') || q.includes('mistake') || q.includes('blunder') || q.includes('dubious')) return 'poor';
  return 'neutral';
}

function userWinPct(c, userIsWhite) {
  const raw = userIsWhite ? c.win_prob : 1 - c.win_prob;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value * 100)));
}

export default function CandidateLab({ fen, playerColor = 'white', canPlay = false, canGenerate = true, onPlayMove, onActiveChange }) {
  const userIsWhite = String(playerColor).toLowerCase() !== 'black';

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

  useEffect(() => {
    onActiveChange?.(busy || candidates.length > 0);
  }, [busy, candidates.length, onActiveChange]);

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

  const currentIndex = selected ? candidates.findIndex((c) => c.rank === selected.rank) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < candidates.length - 1;

  const selectPrev = useCallback(() => {
    if (hasPrev) {
      selectCandidate(candidates[currentIndex - 1]);
    }
  }, [hasPrev, currentIndex, candidates, selectCandidate]);

  const selectNext = useCallback(() => {
    if (hasNext) {
      selectCandidate(candidates[currentIndex + 1]);
    }
  }, [hasNext, currentIndex, candidates, selectCandidate]);

  return (
    <>
      {candidates.length > 0 ? (
        <div className="lab-studio-inline">
          {busy && <div className="lab-shell-progress" aria-hidden="true" />}
          <div className="lab-header">
            <div className="lab-title">
              <h2>Candidate Lab</h2>
            </div>
            <div className="lab-header-actions">
              {labView === 'chain' && (
                <button
                  className="lab-header-btn interactive"
                  onClick={() => { setLabView('candidates'); setSelectedRank(null); }}
                  title="Back to candidates"
                  aria-label="Back to candidates"
                >
                  ←
                </button>
              )}
              {selected && labView !== 'chain' && (
                <button
                  className="lab-header-btn interactive"
                  onClick={() => setSelectedRank(null)}
                  title="Back to all candidates"
                  aria-label="Back to all candidates"
                >
                  ←
                </button>
              )}
              <button
                className="lab-header-btn interactive"
                disabled={busy || !canGenerate}
                onClick={generate}
                title={!canGenerate ? 'Available on your turn only' : busy ? 'Evaluating…' : 'Regenerate candidate moves'}
                aria-label="Regenerate candidates"
              >
                <span className={busy ? 'spin-icon' : ''}>🔄</span>
              </button>
              <button
                className="lab-header-btn interactive"
                onClick={clearAll}
                title="Clear candidates"
                aria-label="Clear candidates"
              >
                ✕
              </button>
            </div>
          </div>

          {error && <div className="alert alert-error" style={{ margin: '10px 18px 0', fontSize: '0.75rem' }}>{error}</div>}
          {stale && (
            <div className="lab-stale">
              The game moved on — these candidates are from an earlier position.{' '}
              <button
                className="btn-sm interactive"
                style={{ marginLeft: '8px' }}
                onClick={generate}
                disabled={busy || !canGenerate}
              >
                Generate Fresh
              </button>
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
                      <div className="lab-focus-board-inner">
                        <div className="lab-focus-board-nav">
                          <button
                            type="button"
                            className="lab-nav-btn interactive"
                            disabled={!hasPrev}
                            onClick={selectPrev}
                            title={hasPrev ? `Previous: #${candidates[currentIndex - 1].rank} ${candidates[currentIndex - 1].move_san}` : 'First candidate'}
                            aria-label="Previous candidate"
                          >
                            ◀ Prev
                          </button>
                          <button
                            type="button"
                            className="lab-nav-btn interactive"
                            disabled={!hasNext}
                            onClick={selectNext}
                            title={hasNext ? `Next: #${candidates[currentIndex + 1].rank} ${candidates[currentIndex + 1].move_san}` : 'Last candidate'}
                            aria-label="Next candidate"
                          >
                            Next ▶
                          </button>
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
                        <div className="lab-focus-board-metrics">
                          <div className="lab-metric-card">
                            <span className="lab-metric-label">ENGINE EVAL</span>
                            <span className={`lab-metric-val mono ${evalScoreClass(selected, userIsWhite)}`}>
                              {fmtUserScore(selected, userIsWhite)}
                            </span>
                            <span className="lab-metric-sub">{selected.rank === 1 ? 'Top line' : `vs #1 (${candidates[0]?.move_san || ''})`}</span>
                          </div>
                          <div className="lab-metric-card">
                            <span className="lab-metric-label">WIN PROBABILITY</span>
                            <span className="lab-metric-val mono win-val">
                              {fmtUserWin(selected, userIsWhite)}
                            </span>
                            <div className="lab-metric-bar">
                              <div className="lab-metric-fill" style={{ width: fmtUserWin(selected, userIsWhite) }} />
                            </div>
                          </div>
                          <div className="lab-metric-card">
                            <span className="lab-metric-label">MOVE RANK</span>
                            <span className="lab-metric-val mono">
                              #{selected.rank}
                            </span>
                            <span className="lab-metric-sub">
                              {selected.rank === 1 ? 'Best choice' : `Concedes ${((selected.cp_delta || 0) / 100).toFixed(2)} pawns`}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="lab-focus-info" role="region" aria-label="Candidate details">
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
                        <span className={`lab-quality tone-${qualityTone(selected.quality)}`}>{selected.quality}</span>
                      </div>
                      <p className="lab-rank-why">
                        {selected.rank === 1
                          ? `Rank #1 — Stockfish's top choice at max depth (no centipawns conceded).`
                          : `Ranked #${selected.rank} — concedes ${((selected.cp_delta || 0) / 100).toFixed(2)} pawns vs #1 (${candidates[0]?.move_san}).`}
                      </p>

                      {explainBusy && <p className="lab-empty">Explaining {selected.move_san}…</p>}
                      {explainError && <div className="alert alert-error" style={{ fontSize: '0.75rem' }}>{explainError}</div>}
                      {explain && !explainBusy && (() => {
                        const thing1Title = renderText(explain.thing_1?.title) || 'Strategic Purpose & Goals';
                        const thing1Summary = renderText(explain.thing_1?.summary);
                        const thing1Reasons = (explain.thing_1?.reasons || explain.narrative?.advantages || [])
                          .map(renderText)
                          .filter((r) => r && r !== thing1Summary);

                        const thing2Title = renderText(explain.thing_2?.title) || 'Move Defects & Flaws';
                        const thing2Summary = renderText(explain.thing_2?.summary);
                        const thing2Reasons = (explain.thing_2?.reasons_to_avoid || [])
                          .map(renderText)
                          .filter((r) => r && r !== thing2Summary);

                        return (
                          <>
                            <div className="lab-pros-cons">
                              <h5>✅ ADVANTAGES</h5>
                              <p><strong>{thing1Title}</strong></p>
                              {thing1Summary && <p>{thing1Summary}</p>}
                              {thing1Reasons.map((r, i) => <p key={i}>• {r}</p>)}
                              {!thing1Summary && thing1Reasons.length === 0 && <p>Occupies key squares and maintains tactical stability.</p>}
                            </div>
                            <div className="lab-pros-cons cons">
                              <h5>⚠️ DISADVANTAGES</h5>
                              <p><strong>{thing2Title}</strong></p>
                              {thing2Summary && <p>{thing2Summary}</p>}
                              {thing2Reasons.map((r, i) => <p key={i}>• {r}</p>)}
                              {!thing2Summary && thing2Reasons.length === 0 && <p>This move has no defects.</p>}
                            </div>
                          </>
                        );
                      })()}

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
                              className="interactive"
                              style={rangeFill(simN, 1, 10)}
                              onChange={(e) => setSimN(+e.target.value)} />
                            <em>{simN}</em>
                          </label>
                          <label className="sim-slider">
                            <span>Depth</span>
                            <input type="range" min="8" max="20" value={simDepth}
                              className="interactive"
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
                        className={`lab-card interactive${c.rank === 1 ? ' is-top' : ''}`}
                        data-rank={c.rank}
                        onClick={() => selectCandidate(c)}
                        aria-label={`Candidate ${c.rank}: ${c.move_san}`}
                      >
                        <div className="lab-card-rank">
                          <span className="lab-medal">{RANK_MEDALS[c.rank - 1] || `#${c.rank}`}</span>
                          <span className="lab-san">{c.move_san}</span>
                          <span className={`lab-quality tone-${qualityTone(c.quality)}`}>{c.quality}</span>
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
                          <span className={`lab-eval-chip mono ${evalScoreClass(c, userIsWhite)}`} title="Engine evaluation (pawns)">
                            {fmtUserScore(c, userIsWhite)}
                          </span>
                          <span className="lab-win-chip mono" title="Estimated win probability">
                            {fmtUserWin(c, userIsWhite)}
                          </span>
                          <span className="lab-delta">
                            {c.rank === 1 ? 'engine top' : `−${((c.cp_delta || 0) / 100).toFixed(2)} vs #1`}
                          </span>
                        </div>
                        <span className="lab-eval-track" aria-hidden="true">
                          <span style={{ width: `${userWinPct(c, userIsWhite)}%` }} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </LabViewBoundary>
        </div>
      ) : (
        <div className="lab-studio-inline lab-studio-empty">
          {busy && <div className="lab-shell-progress" aria-hidden="true" />}
          <div className="lab-empty-shell">
            <header className="lab-empty-header">
              <div className="lab-title">
                <h2>Candidate Lab</h2>
              </div>
            </header>

            <div className="lab-empty-body">
              <div className="lab-empty-hero">
                <div>
                  <span className="lab-kicker">Position analysis</span>
                  <h3>What is the strongest move here?</h3>
                  <p>Generate a ranked shortlist, study the trade-offs, then commit with confidence.</p>
                </div>
                <span className="lab-empty-hero-mark" aria-hidden="true">♞</span>
              </div>

              <section className="lab-setup-card">
                <span className="lab-kicker">Configure analysis</span>
                <h3>Build your candidate list</h3>
                <p className="lab-setup-copy">
                  Stockfish examines the position and surfaces the strongest continuations,
                  ranked by evaluation and tactical soundness.
                </p>

                <div className="lab-count-control">
                  <div className="lab-count-head">
                    <label htmlFor="candidate-count">Candidate moves</label>
                    <span className="lab-count-value">
                      {count}<small>lines</small>
                    </span>
                  </div>
                  <input
                    id="candidate-count"
                    className="interactive"
                    type="range"
                    min="1"
                    max={MAX_COUNT}
                    value={count}
                    style={rangeFill(count, 1, MAX_COUNT)}
                    onChange={(e) => setCount(+e.target.value)}
                  />
                  <div className="lab-count-scale" aria-hidden="true">
                    <span>1</span>
                    <span>{MAX_COUNT}</span>
                  </div>
                </div>

                <div className="lab-run-meta">
                  <span className="lab-depth-pill">Stockfish · depth {CANDIDATE_DEPTH}</span>
                  <span>Usually 5–20 seconds</span>
                </div>

                <button
                  className="lab-generate-btn interactive"
                  disabled={busy || !fen || !canGenerate}
                  title={!canGenerate ? 'Available on your turn — ranks your moves only' : undefined}
                  onClick={generate}
                >
                  <span className="lab-generate-icon" aria-hidden="true">🔬</span>
                  <span>{busy ? 'Evaluating position…' : 'Generate candidates'}</span>
                  <span className="lab-generate-arrow" aria-hidden="true">→</span>
                </button>

                {!canGenerate && (
                  <p className="lab-inline-note">Analysis is available on your turn — it ranks moves for your side only.</p>
                )}
                {busy && (
                  <div className="lab-generating-badge" role="status">
                    <span className="lab-status-dot" />
                    <span>Stockfish depth {CANDIDATE_DEPTH} analysis in progress…</span>
                  </div>
                )}
                {error && (
                  <div className="alert alert-error" role="alert" style={{ fontSize: '0.75rem' }}>
                    {error}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
