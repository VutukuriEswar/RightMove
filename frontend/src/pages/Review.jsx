import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { gamesApi, coachApi, reportApi } from '../lib/api';
import { buildPositions, buildPgn, formatEval, loadGameLog, moveRecordToSquares } from '../lib/chessUtils';
import Board2D from '../components/board/Board2D';
import Board3D from '../components/board/Board3D';
import MoveList from '../components/game/MoveList';
import GameSummaryCard from '../components/game/GameSummaryCard';

const ENGINE_INTERVAL_MS = 800;

export default function Review() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [game, setGame] = useState(null);
  const [summary, setSummary] = useState(null);
  const [moves, setMoves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentMoveIdx, setCurrentMoveIdx] = useState(-1);
  const [view3D, setView3D] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const playTimerRef = useRef(null);
  const [reportData, setReportData] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [posBusy, setPosBusy] = useState(false);
  const [posData, setPosData] = useState(null);
  const [coachError, setCoachError] = useState(null);
  const [moveInsight, setMoveInsight] = useState(null);
  const [moveInsightBusy, setMoveInsightBusy] = useState(false);
  const reportRef = useRef(null);

  useEffect(() => {
    Promise.all([
      gamesApi.get(id),
      gamesApi.getSummary(id).catch(() => null),
      loadGameLog(id),
    ]).then(([gameData, summaryData, localMoves]) => {
      setGame(gameData);
      setSummary(summaryData);
      if (localMoves) setMoves(localMoves);
      setCurrentMoveIdx(localMoves ? localMoves.length - 1 : -1);
      setLoading(false);
    }).catch(err => { setError(err.message); setLoading(false); });
  }, [id]);

  const fens = useMemo(() => {
    if (!moves.length) return ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];
    return buildPositions(moves.map(m => m.san));
  }, [moves]);

  const isEngineGame = game?.mode === 'bot';
  const playerColor = game?.player_color || 'white';

  const bestMovesStats = useMemo(() => {
    if (!moves.length) return null;
    const userMoves = moves.filter(m => !m.is_bot);
    const countBest = (arr) => arr.filter(m => m.classification === 'best').length;
    const pct = (count, total) => total === 0 ? null : Math.round((count / total) * 100);
    return {
      user: { total: userMoves.length, best: countBest(userMoves), pct: pct(countBest(userMoves), userMoves.length) },
    };
  }, [moves]);

  useEffect(() => {
    if (loading) return;
    if (searchParams.get('report') === '1' && game?.mode === 'bot') {
      requestAnimationFrame(() => {
        reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      if (moves.length) generateReport();
    }
  }, [loading, game, moves.length]);

  const buildReportPgn = () =>
    buildPgn(moves.map(m => m.san), {
      white: playerColor === 'white' ? 'You' : 'Coach',
      black: playerColor === 'black' ? 'You' : 'Coach',
      result: game?.result === 'draw' ? '1/2-1/2' : game?.result === 'white' ? '1-0' : game?.result === 'black' ? '0-1' : '*',
    });

  const generateReport = useCallback(async () => {
    setReportBusy(true); setCoachError(null);
    try {
      const pgn = buildReportPgn();
      const data = await reportApi.fullReport(pgn);
      setReportData(data);
    } catch (err) {
      setCoachError(err.message || 'Report generation failed');
    } finally {
      setReportBusy(false);
    }
  }, [moves, playerColor, game?.result]);

  const downloadPdf = useCallback(async () => {
    setCoachError(null);
    try {
      const blob = await reportApi.downloadPdf(buildReportPgn());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = 'chess_coach_report.pdf'; a.click(); URL.revokeObjectURL(url);
    } catch (err) {
      setCoachError(err.message || 'PDF generation failed');
    }
  }, [moves, playerColor, game?.result]);

  const analyzePosition = useCallback(async () => {
    setPosBusy(true); setCoachError(null);
    try {
      setPosData(await coachApi.position(fens[currentMoveIdx + 1]));
    } catch (err) {
      setCoachError(err.message || 'Position analysis failed');
    } finally {
      setPosBusy(false);
    }
  }, [fens, currentMoveIdx]);

  const scheduleNext = useCallback((fromIdx) => {
    if (fromIdx >= moves.length - 1) { setIsPlaying(false); return; }
    const nextMove = moves[fromIdx + 1];
    const delay = (isEngineGame || !nextMove?.elapsed_ms)
      ? ENGINE_INTERVAL_MS
      : Math.min(Math.max(nextMove.elapsed_ms, 300), 8000);
    playTimerRef.current = setTimeout(() => {
      setCurrentMoveIdx(prev => { const next = prev + 1; scheduleNext(next); return next; });
    }, delay);
  }, [moves, isEngineGame]);

  useEffect(() => {
    if (!isPlaying) { if (playTimerRef.current) clearTimeout(playTimerRef.current); return; }
    if (currentMoveIdx >= moves.length - 1) { setCurrentMoveIdx(-1); scheduleNext(-1); }
    else { scheduleNext(currentMoveIdx); }
    return () => { if (playTimerRef.current) clearTimeout(playTimerRef.current); };
  }, [isPlaying]);

  const handlePlayPause = () => setIsPlaying(p => !p);
  const step = (delta) => { setIsPlaying(false); setCurrentMoveIdx(prev => Math.max(-1, Math.min(moves.length - 1, prev + delta))); };

  useEffect(() => {
    if (currentMoveIdx < 0 || !moves[currentMoveIdx]?.uci) { setMoveInsight(null); return; }
    let cancelled = false;
    setMoveInsightBusy(true);
    const t = setTimeout(async () => {
      try {
        const fenBefore = fens[currentMoveIdx];
        const uci = moves[currentMoveIdx].uci;
        if (!fenBefore || !uci) return;
        const data = await coachApi.explain(fenBefore, uci, null, 0, null);
        if (!cancelled && !data?.error) setMoveInsight(data);
      } catch (_) {
      } finally {
        if (!cancelled) setMoveInsightBusy(false);
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [currentMoveIdx, moves.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') { step(-1); }
      else if (e.key === 'ArrowRight') { step(1); }
      else if (e.key === 'ArrowUp') { setIsPlaying(false); setCurrentMoveIdx(-1); }
      else if (e.key === 'ArrowDown') { setIsPlaying(false); setCurrentMoveIdx(moves.length - 1); }
      else if (e.key === ' ') { e.preventDefault(); handlePlayPause(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moves.length, isPlaying]);

  if (loading) return <div className="page"><div className="spinner-large" /></div>;
  if (error) return <div className="page"><div className="alert alert-error">{error}</div></div>;

  const currentFen = fens[currentMoveIdx + 1];
  const lastMove = currentMoveIdx >= 0 ? moves[currentMoveIdx] : null;
  const lastMoveSq = moveRecordToSquares(lastMove);

  const PARAM_ORDER = [
    'material', 'piece_placement', 'mobility', 'center_control', 'king_safety',
    'pawn_structure', 'tactical_defense', 'bishop_pair', 'rook_open_files',
    'space_advantage', 'knight_outposts',
  ];

  return (
    <div className="review-page page-full">
      <div className="review-layout">
        <div className="review-main">
          {summary && (
            <div className="review-summary-section">
              <GameSummaryCard
                summary={summary}
                whiteUsername={playerColor === 'white' ? 'You' : 'Opponent'}
                blackUsername={playerColor === 'black' ? 'You' : 'Opponent'}
              />
            </div>
          )}
          <div className="review-board-container">
            <div className="review-controls-top">
              <button className="btn btn-ghost" onClick={() => setView3D(!view3D)}>
                {view3D ? '2D View' : '3D View'}
              </button>
            </div>
            <div className="board-wrapper">
              {view3D ? (
                <Board3D fen={currentFen} disabled={true} lastMove={lastMoveSq} />
              ) : (
                <Board2D id="reviewBoard" fen={currentFen} disabled={true} lastMove={lastMoveSq} />
              )}
            </div>
            <div className="review-controls-bottom">
              <button className="btn btn-secondary review-nav-btn" title="Start" onClick={() => { setIsPlaying(false); setCurrentMoveIdx(-1); }}>|&#9664;</button>
              <button className="btn btn-secondary review-nav-btn" title="Prev" onClick={() => step(-1)}>&#9664;</button>
              <button className={`review-play-btn ${isPlaying ? 'playing' : ''}`} onClick={handlePlayPause}>
                {isPlaying ? '&#9208;' : '&#9654;'}
              </button>
              <button className="btn btn-secondary review-nav-btn" title="Next" onClick={() => step(1)}>&#9654;</button>
              <button className="btn btn-secondary review-nav-btn" title="End" onClick={() => { setIsPlaying(false); setCurrentMoveIdx(moves.length - 1); }}>&#9654;|</button>
            </div>
            <p className="review-hint">Arrow keys to navigate · Space to play/pause</p>
            {lastMove && (
              <div className="review-coach-section" style={{ maxWidth: '600px' }}>
                <h3>Move Insight</h3>
                {moveInsightBusy && !moveInsight && <p className="review-report-text">Explaining this move...</p>}
                {moveInsight && (
                  <div>
                    <p className="review-report-line"><strong>Advantages:</strong></p>
                    <p className="review-report-text">{moveInsight.thing_1?.summary || 'Solid move.'}</p>
                    {(moveInsight.thing_1?.reasons || []).slice(0, 3).map((r, i) => (
                      <p key={i} className="review-report-text">* {r}</p>
                    ))}
                    <p className="review-report-line" style={{ marginTop: 8 }}><strong>Disadvantages:</strong></p>
                    {moveInsight.thing_2?.has_defects ? (
                      <div>
                        <p className="review-report-text">{moveInsight.thing_2?.summary}</p>
                        {(moveInsight.thing_2?.reasons_to_avoid || []).slice(0, 3).map((r, i) => (
                          <p key={i} className="review-report-text">* {r}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="review-report-text">No clear harm.</p>
                    )}
                    {moveInsight.best_move?.san && (
                      <p className="review-report-text" style={{ marginTop: 8 }}>
                        <strong>Best was:</strong> {moveInsight.best_move.san}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {isEngineGame && (
            <div className="review-coach-section" ref={reportRef}>
              <h3>Coach Report</h3>
              {coachError && <div className="alert alert-error">{coachError}</div>}
              <div className="review-coach-buttons">
                <button className="btn btn-primary" onClick={generateReport} disabled={reportBusy}>
                  {reportBusy ? 'Generating...' : 'Full Report'}
                </button>
                {reportData && (
                  <button className="btn btn-secondary" onClick={downloadPdf}>
                    Download PDF
                  </button>
                )}
              </div>
              {reportData && (
                <div className="review-report card">
                  <p className="review-report-line"><strong>Accuracy:</strong> {Math.round((reportData.accuracy || 0) * 100)}%</p>
                  <p className="review-report-line"><strong>Grade:</strong> {reportData.grade}</p>
                  <p className="review-report-line"><strong>Style:</strong> {reportData.style}</p>
                  {reportData.summary_text && <p className="review-report-text">{reportData.summary_text}</p>}
                  {bestMovesStats && (
                    <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(212,175,55,0.2)' }}>
                      <p className="review-report-line" style={{ marginBottom: '6px' }}><strong>Best Moves Played</strong></p>
                      <p className="review-report-text">
                        <strong>You:</strong>&nbsp;
                        {bestMovesStats.user.pct !== null
                          ? `${bestMovesStats.user.pct}% best moves (${bestMovesStats.user.best}/${bestMovesStats.user.total})`
                          : 'No moves recorded'}
                      </p>
                    </div>
                  )}
                  {reportData.weaknesses?.length > 0 && (
                    <div>
                      <h4>Weaknesses</h4>
                      {reportData.weaknesses.map((w, i) => <p key={i} className="review-report-text">{w}</p>)}
                    </div>
                  )}
                  {reportData.training_plan?.length > 0 && (
                    <div>
                      <h4>Training Plan</h4>
                      {reportData.training_plan.map((t, i) => (
                        <p key={i} className="review-report-text">{typeof t === 'string' ? t : t.topic || JSON.stringify(t)}</p>
                      ))}
                    </div>
                  )}
                  {reportData.opening_recommendations?.length > 0 && (
                    <div>
                      <h4>Opening Recommendations</h4>
                      {reportData.opening_recommendations.map((o, i) => (
                        <p key={i} className="review-report-text">{typeof o === 'string' ? o : o.opening || JSON.stringify(o)}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <h4 style={{ marginTop: '18px' }}>Position Tools</h4>
              <div className="review-coach-buttons">
                <button className="btn btn-secondary" onClick={analyzePosition} disabled={posBusy}>
                  {posBusy ? 'Analyzing...' : 'Analyze Position'}
                </button>
              </div>
              {posData && (
                <div className="review-report card">
                  <h4>Position Assessment</h4>
                  <p className="review-report-line"><strong>Score:</strong> {formatEval(posData.net_score_centipawns)}</p>
                  <p className="review-report-line"><strong>Phase:</strong> {posData.game_phase}</p>
                  <p className="review-report-text">{posData.verdict}</p>
                  {posData.strategic_insights?.map((s, i) => (
                    <p key={i} className="review-report-text">* {s}</p>
                  ))}
                  {posData.pros_cons?.white && (
                    <div>
                      <p className="review-report-line" style={{ marginTop: 8 }}><strong>White advantages:</strong></p>
                      {posData.pros_cons.white.advantages.map((a, i) => <p key={i} className="review-report-text">* {a}</p>)}
                      <p className="review-report-line" style={{ marginTop: 8 }}><strong>White disadvantages:</strong></p>
                      {posData.pros_cons.white.disadvantages.map((d, i) => <p key={i} className="review-report-text">* {d}</p>)}
                    </div>
                  )}
                  {posData.pros_cons?.black && (
                    <div>
                      <p className="review-report-line" style={{ marginTop: 8 }}><strong>Black advantages:</strong></p>
                      {posData.pros_cons.black.advantages.map((a, i) => <p key={i} className="review-report-text">* {a}</p>)}
                      <p className="review-report-line" style={{ marginTop: 8 }}><strong>Black disadvantages:</strong></p>
                      {posData.pros_cons.black.disadvantages.map((d, i) => <p key={i} className="review-report-text">* {d}</p>)}
                    </div>
                  )}
                  {posData.parameters && (
                    <div className="params-table-wrap" style={{ marginTop: '16px' }}>
                      <p className="review-report-line" style={{ marginBottom: '8px' }}><strong>Parameters:</strong></p>
                      <table className="params-table">
                        <thead>
                          <tr>
                            <th>Parameter</th>
                            <th>White</th>
                            <th>Black</th>
                            <th>Diff (W)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {PARAM_ORDER.filter((k) => posData.parameters[k]).map((k) => {
                            const p = posData.parameters[k];
                            const d = p.diff;
                            return (
                              <tr key={k} className="param-row">
                                <td className="param-name" title={p.description}>{p.name}</td>
                                <td className="param-val">{Math.round(p.white)}</td>
                                <td className="param-val">{Math.round(p.black)}</td>
                                <td className={`param-diff ${d > 0 ? 'pw' : d < 0 ? 'pb' : ''}`}>
                                  {Number.isFinite(d) ? `${d > 0 ? '+' : ''}${Math.round(d)}` : '0'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="review-sidebar">
          <div className="move-list-container card">
            <MoveList moves={moves} activeIndex={currentMoveIdx} onMoveClick={(idx) => { setIsPlaying(false); setCurrentMoveIdx(idx); }} />
          </div>
          <div className="review-actions card">
            <Link to="/history" className="btn btn-secondary" style={{width:'100%',marginBottom:'8px'}}>Match History</Link>
            <Link to="/lobby" className="btn btn-primary" style={{width:'100%'}}>New Game</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
