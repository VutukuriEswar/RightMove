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
  const [motifBusy, setMotifBusy] = useState(false);
  const [motifData, setMotifData] = useState(null);
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

  const scanTactics = useCallback(async () => {
    setMotifBusy(true); setCoachError(null);
    try {
      setMotifData(await coachApi.motifs(fens[currentMoveIdx + 1]));
    } catch (err) {
      setCoachError(err.message || 'Tactics scan failed');
    } finally {
      setMotifBusy(false);
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
      if (e.key === 'ArrowLeft')  { step(-1); }
      else if (e.key === 'ArrowRight') { step(1); }
      else if (e.key === 'ArrowUp')   { setIsPlaying(false); setCurrentMoveIdx(-1); }
      else if (e.key === 'ArrowDown') { setIsPlaying(false); setCurrentMoveIdx(moves.length - 1); }
      else if (e.key === ' ') { e.preventDefault(); handlePlayPause(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);

  }, [moves.length, isPlaying]);

  if (loading) return <div className="page"><div className="spinner-large" /></div>;
  if (error)   return <div className="page"><div className="alert alert-error">{error}</div></div>;

  const currentFen = fens[currentMoveIdx + 1];
  const lastMove = currentMoveIdx >= 0 ? moves[currentMoveIdx] : null;
  const lastMoveSq = moveRecordToSquares(lastMove);

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
              <button className="btn btn-secondary review-nav-btn" title="Start" onClick={() => { setIsPlaying(false); setCurrentMoveIdx(-1); }}>|◀</button>
              <button className="btn btn-secondary review-nav-btn" title="Prev (←)" onClick={() => step(-1)}>◀</button>
              <button className={`review-play-btn ${isPlaying ? 'playing' : ''}`} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'} onClick={handlePlayPause}>
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button className="btn btn-secondary review-nav-btn" title="Next (→)" onClick={() => step(1)}>▶</button>
              <button className="btn btn-secondary review-nav-btn" title="End" onClick={() => { setIsPlaying(false); setCurrentMoveIdx(moves.length - 1); }}>▶|</button>
            </div>
            <p className="review-hint">Arrow keys to navigate · Space to play/pause</p>

            {lastMove && (
              <div className="review-coach-section" style={{ maxWidth: '600px' }}>
                <h3>Move Insight — {(currentMoveIdx % 2 === 0) ? 'White' : 'Black'} played {lastMove.san}</h3>
                {moveInsightBusy && !moveInsight && <p className="review-report-text">Explaining this move…</p>}
                {moveInsight && (
                  <>
                    <p className="review-report-line"><strong>✅ Advantages:</strong></p>
                    <p className="review-report-text">{moveInsight.thing_1?.summary || 'Solid move.'}</p>
                    {(moveInsight.thing_1?.reasons || []).slice(0, 3).map((r, i) => (
                      <p key={i} className="review-report-text">• {r}</p>
                    ))}
                    <p className="review-report-line" style={{ marginTop: 8 }}><strong>⚠️ Disadvantages:</strong></p>
                    {moveInsight.thing_2?.has_defects ? (
                      <>
                        <p className="review-report-text">{moveInsight.thing_2?.summary}</p>
                        {(moveInsight.thing_2?.reasons_to_avoid || []).slice(0, 3).map((r, i) => (
                          <p key={i} className="review-report-text">• {r}</p>
                        ))}
                      </>
                    ) : (
                      <p className="review-report-text">No clear harm — this move has no defects.</p>
                    )}
                    {moveInsight.best_move?.san && (
                      <p className="review-report-text" style={{ marginTop: 8 }}>
                        <strong>Best was:</strong> {moveInsight.best_move.san} — {moveInsight.best_move?.summary || ''}
                      </p>
                    )}
                  </>
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
                  {reportBusy ? 'Generating…' : '📊 Full Report'}
                </button>
                {reportData && (
                  <button className="btn btn-secondary" onClick={downloadPdf}>
                    📄 Download PDF
                  </button>
                )}
              </div>

              {reportData && (
                <div className="review-report card">
                  <p className="review-report-line"><strong>Accuracy:</strong> {Math.round((reportData.accuracy || 0) * 100)}%</p>
                  <p className="review-report-line"><strong>Grade:</strong> {reportData.grade}</p>
                  <p className="review-report-line"><strong>Style:</strong> {reportData.style}</p>
                  {reportData.summary_text && <p className="review-report-text">{reportData.summary_text}</p>}

                  {reportData.weaknesses?.length > 0 && (
                    <>
                      <h4>⚠ Weaknesses</h4>
                      {reportData.weaknesses.map((w, i) => <p key={i} className="review-report-text">{w}</p>)}
                    </>
                  )}

                  {reportData.training_plan?.length > 0 && (
                    <>
                      <h4>📋 Training Plan</h4>
                      {reportData.training_plan.map((t, i) => (
                        <p key={i} className="review-report-text">{typeof t === 'string' ? t : t.topic || JSON.stringify(t)}</p>
                      ))}
                    </>
                  )}

                  {reportData.opening_recommendations?.length > 0 && (
                    <>
                      <h4>📖 Opening Recommendations</h4>
                      {reportData.opening_recommendations.map((o, i) => (
                        <p key={i} className="review-report-text">{typeof o === 'string' ? o : o.opening || JSON.stringify(o)}</p>
                      ))}
                    </>
                  )}
                </div>
              )}

              <h4 style={{ marginTop: '18px' }}>Position Tools</h4>
              <div className="review-coach-buttons">
                <button className="btn btn-secondary" onClick={analyzePosition} disabled={posBusy}>
                  {posBusy ? 'Analyzing…' : '📐 Analyze Position'}
                </button>
                <button className="btn btn-secondary" onClick={scanTactics} disabled={motifBusy}>
                  {motifBusy ? 'Scanning…' : '🎯 Scan Tactics'}
                </button>
              </div>

              {posData && (
                <div className="review-report card">
                  <h4>Position Assessment</h4>
                  <p className="review-report-line"><strong>Score:</strong> {formatEval(posData.net_score_centipawns)}</p>
                  <p className="review-report-line"><strong>Phase:</strong> {posData.game_phase}</p>
                  <p className="review-report-text">{posData.verdict}</p>
                  {posData.strategic_insights?.map((s, i) => (
                    <p key={i} className="review-report-text">• {s}</p>
                  ))}
                  {posData.pros_cons?.white && (
                    <>
                      <p className="review-report-line" style={{ marginTop: 8 }}><strong>✅ White advantages:</strong></p>
                      {posData.pros_cons.white.advantages.map((a, i) => <p key={i} className="review-report-text">• {a}</p>)}
                      <p className="review-report-line" style={{ marginTop: 8 }}><strong>⚠️ White disadvantages:</strong></p>
                      {posData.pros_cons.white.disadvantages.map((d, i) => <p key={i} className="review-report-text">• {d}</p>)}
                    </>
                  )}
                  {posData.pros_cons?.black && (
                    <>
                      <p className="review-report-line" style={{ marginTop: 8 }}><strong>✅ Black advantages:</strong></p>
                      {posData.pros_cons.black.advantages.map((a, i) => <p key={i} className="review-report-text">• {a}</p>)}
                      <p className="review-report-line" style={{ marginTop: 8 }}><strong>⚠️ Black disadvantages:</strong></p>
                      {posData.pros_cons.black.disadvantages.map((d, i) => <p key={i} className="review-report-text">• {d}</p>)}
                    </>
                  )}
                </div>
              )}

              {motifData && (
                <div className="review-report card">
                  <h4>Tactical Motifs</h4>
                  {(motifData.motifs || []).length === 0
                    ? <p className="review-report-text">No tactical motifs detected in this position.</p>
                    : motifData.motifs.map((m, i) => <p key={i} className="review-report-text">• {m}</p>)}
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
