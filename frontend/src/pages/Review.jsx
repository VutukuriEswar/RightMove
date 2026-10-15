import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { gamesApi, coachApi, reportApi } from '../lib/api';
import { buildPositions, buildPgn, formatEval, loadGameLog, moveRecordToSquares, normalizeClassification, accuracyLetter, CLASSIFICATION_META } from '../lib/chessUtils';
import Board2D from '../components/board/Board2D';
import MoveList from '../components/game/MoveList';
import GameSummaryCard from '../components/game/GameSummaryCard';

const ENGINE_INTERVAL_MS = 800;

const CLASS_ORDER = ['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

export default function Review() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [game, setGame] = useState(null);
  const [summary, setSummary] = useState(null);
  const [moves, setMoves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [movesSource, setMovesSource] = useState(null);
  const [currentMoveIdx, setCurrentMoveIdx] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const playTimerRef = useRef(null);
  const [reportData, setReportData] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [posBusy, setPosBusy] = useState(false);
  const [posData, setPosData] = useState(null);
  const [coachError, setCoachError] = useState(null);
  const [moveInsight, setMoveInsight] = useState(null);
  const [moveInsightBusy, setMoveInsightBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rematchBusy, setRematchBusy] = useState(false);
  const reportRef = useRef(null);
  const insightCache = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      gamesApi.get(id),
      gamesApi.getSummary(id).catch(() => null),
      loadGameLog(id).catch(() => null),
      gamesApi.getMoves(id).catch(() => null),
    ]).then(([gameData, summaryData, localMoves, serverMoves]) => {
      if (cancelled) return;
      setGame(gameData);
      setSummary(summaryData);
      const local = Array.isArray(localMoves) ? localMoves : null;
      const remote = serverMoves && Array.isArray(serverMoves.moves) ? serverMoves.moves : null;
      if (local && local.length) {
        setMoves(local);
        setMovesSource('device');
        setCurrentMoveIdx(local.length - 1);
      } else if (remote && remote.length) {
        setMoves(remote);
        setMovesSource('server');
        setCurrentMoveIdx(remote.length - 1);
      } else {
        setMoves([]);
        setMovesSource('empty');
        setCurrentMoveIdx(-1);
      }
      setLoading(false);
    }).catch(err => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  const fens = useMemo(() => {
    if (!moves.length) return ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];
    try {
      return buildPositions(moves.map(m => m.san));
    } catch (_) {
      return ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];
    }
  }, [moves]);

  const isEngineGame = game?.mode === 'bot';
  const playerColor = game?.player_color || 'white';
  const whiteName = game?.white_username || (playerColor === 'white' ? 'You' : 'Opponent');
  const blackName = game?.black_username || (playerColor === 'black' ? 'You' : 'Opponent');

  const mergedMoves = useMemo(() => {
    if (!reportData?.moves?.length) return moves;
    const byPly = new Map();
    reportData.moves.forEach((rm) => {
      const ply = rm.ply ?? (rm.fullmove_number != null ? (rm.turn === 'Black' ? rm.fullmove_number * 2 : rm.fullmove_number * 2 - 1) : null);
      if (ply != null) byPly.set(ply, rm);
    });
    return moves.map((m, idx) => {
      const ply = m.ply ?? idx + 1;
      const rm = byPly.get(ply);
      if (!rm) return m;
      return { ...m, classification: rm.classification, cp_loss: rm.cp_loss, accuracy_score: rm.accuracy_score, best_move: rm.best_move_san || rm.best_move };
    });
  }, [moves, reportData]);

  const qualityCounts = useMemo(() => {
    const counts = { brilliant: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    mergedMoves.forEach((m) => {
      const k = normalizeClassification(m.classification);
      if (counts[k] !== undefined) counts[k] += 1;
    });
    return counts;
  }, [mergedMoves]);

  const strongStats = useMemo(() => {
    if (!mergedMoves.length) return null;
    const isStrong = (m) => {
      const k = normalizeClassification(m.classification);
      return k === 'brilliant' || k === 'best' || k === 'excellent';
    };
    const mine = mergedMoves.filter((m, idx) => {
      const isWhite = (idx % 2) === 0;
      return playerColor === 'white' ? isWhite : !isWhite;
    });
    const strong = mine.filter(isStrong).length;
    const pct = mine.length ? Math.round((strong / mine.length) * 100) : null;
    return { total: mine.length, strong, pct };
  }, [mergedMoves, playerColor]);

  useEffect(() => {
    if (loading) return;
    if (searchParams.get('report') === '1') {
      requestAnimationFrame(() => {
        reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      if (moves.length && !reportData && !reportBusy) generateReport();
    }
  }, [loading, moves.length]);

  const buildReportPgn = () => {
    const sans = moves.map(m => m.san).filter(Boolean);
    return buildPgn(sans, {
      white: playerColor === 'white' ? 'You' : 'Coach',
      black: playerColor === 'black' ? 'You' : 'Coach',
      result: game?.result === 'draw' ? '1/2-1/2' : game?.result === 'white' ? '1-0' : game?.result === 'black' ? '0-1' : '*',
    });
  };

  const generateReport = useCallback(async () => {
    if (!moves.length) return;
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
    if (!moves.length || pdfBusy) return;
    setPdfBusy(true); setCoachError(null);
    try {
      const blob = await reportApi.downloadPdf(buildReportPgn());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `rightmove-report-${id}.pdf`; a.click(); URL.revokeObjectURL(url);
    } catch (err) {
      setCoachError(err.message || 'PDF generation failed');
    } finally {
      setPdfBusy(false);
    }
  }, [moves, playerColor, game?.result, pdfBusy, id]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      setCopied(false);
    }
  }, []);

  const handleRematch = useCallback(async () => {
    if (rematchBusy) return;
    const friend = playerColor === 'white' ? game?.black_username : game?.white_username;
    if (!friend) return;
    setRematchBusy(true);
    setCoachError(null);
    try {
      const { id: newId } = await gamesApi.create({
        mode: 'friend',
        friend_username: friend,
        time_control_seconds: game?.time_control_seconds ?? 600,
        increment_seconds: game?.increment_seconds ?? 0,
      });
      navigate(`/game/${newId}`);
    } catch (err) {
      setCoachError(err.message || 'Rematch failed');
      setRematchBusy(false);
    }
  }, [rematchBusy, playerColor, game, navigate]);

  const analyzePosition = useCallback(async () => {
    const fen = fens[currentMoveIdx + 1];
    if (!fen) return;
    setPosBusy(true); setCoachError(null);
    try {
      setPosData(await coachApi.position(fen));
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

  useEffect(() => () => { if (playTimerRef.current) clearTimeout(playTimerRef.current); }, []);

  const handlePlayPause = () => { if (moves.length) setIsPlaying(p => !p); };
  const step = (delta) => { setIsPlaying(false); setCurrentMoveIdx(prev => Math.max(-1, Math.min(moves.length - 1, prev + delta))); };

  useEffect(() => {
    if (currentMoveIdx < 0 || !moves[currentMoveIdx]?.uci) { setMoveInsight(null); return; }
    const fenBefore = fens[currentMoveIdx];
    const uci = moves[currentMoveIdx].uci;
    if (!fenBefore || !uci) { setMoveInsight(null); return; }
    const key = `${fenBefore}|${uci}`;
    if (insightCache.current.has(key)) { setMoveInsight(insightCache.current.get(key)); return; }
    let cancelled = false;
    setMoveInsightBusy(true);
    const t = setTimeout(async () => {
      try {
        const data = await coachApi.explain(fenBefore, uci, null, 0, null);
        if (!cancelled && !data?.error) {
          insightCache.current.set(key, data);
          setMoveInsight(data);
        }
      } catch (_) {
      } finally {
        if (!cancelled) setMoveInsightBusy(false);
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [currentMoveIdx, moves, fens]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = String(e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
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
  const lastMove = currentMoveIdx >= 0 ? mergedMoves[currentMoveIdx] : null;
  const lastMoveSq = moveRecordToSquares(lastMove);
  const currentCls = lastMove?.classification ? normalizeClassification(lastMove.classification) : null;

  const PARAM_ORDER = [
    'material', 'piece_placement', 'mobility', 'center_control', 'king_safety',
    'pawn_structure', 'tactical_defense', 'bishop_pair', 'rook_open_files',
    'space_advantage', 'knight_outposts',
  ];

  const accW = reportData?.accuracy_white ?? summary?.accuracy_white ?? null;
  const accB = reportData?.accuracy_black ?? summary?.accuracy_black ?? null;

  return (
    <div className="review-page page-full">
      <div className="review-layout">
        <div className="review-main">
          <div className="review-title-row">
            <div>
              <p className="review-kicker">Match Review</p>
              <h1 className="review-title">{whiteName} vs {blackName}</h1>
              <p className="review-sub">
                {game?.result ? `Result: ${game.result}` : 'Result pending'}
                {movesSource === 'server' ? ' · loaded from server' : movesSource === 'device' ? ' · loaded from this device' : ''}
                {moves.length ? ` · ${moves.length} moves` : ''}
              </p>
            </div>
            <button className="btn btn-secondary" onClick={copyLink}>{copied ? 'Copied!' : 'Copy link'}</button>
          </div>
          {summary && (
            <div className="review-summary-section">
              <GameSummaryCard
                summary={summary}
                whiteUsername={whiteName}
                blackUsername={blackName}
              />
            </div>
          )}
          {!moves.length && (
            <div className="review-coach-section">
              <h3>No moves found</h3>
              <p className="review-report-text">This game has no saved moves on this device or the server yet. Finish the game to generate a review.</p>
            </div>
          )}
          {moves.length > 0 && (
          <div className="review-board-container">
            <div className="review-controls-top">
              {lastMove && (
                <span className="review-move-pill">
                  {Math.floor(currentMoveIdx / 2) + 1}{currentMoveIdx % 2 === 0 ? '.' : '...'} {lastMove.san}
                  {currentCls && <span className={`badge badge-${currentCls}`} style={{ marginLeft: 8 }}>{currentCls}</span>}
                </span>
              )}
            </div>
            <div className="board-wrapper">
              <Board2D id="reviewBoard" fen={currentFen} disabled={true} lastMove={lastMoveSq} />
            </div>
            <div className="review-controls-bottom">
              <button
                className="btn btn-secondary review-nav-btn"
                title="Start"
                aria-label="First move"
                onClick={() => { setIsPlaying(false); setCurrentMoveIdx(-1); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                </svg>
              </button>
              <button
                className="btn btn-secondary review-nav-btn"
                title="Prev"
                aria-label="Previous move"
                onClick={() => step(-1)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 18l-9-6 9-6v12z"/>
                </svg>
              </button>
              <button
                className={`review-play-btn ${isPlaying ? 'playing' : ''}`}
                title={isPlaying ? 'Pause' : 'Play'}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                onClick={handlePlayPause}
              >
                {isPlaying ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                )}
              </button>
              <button
                className="btn btn-secondary review-nav-btn"
                title="Next"
                aria-label="Next move"
                onClick={() => step(1)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6l9 6-9 6V6z"/>
                </svg>
              </button>
              <button
                className="btn btn-secondary review-nav-btn"
                title="End"
                aria-label="Last move"
                onClick={() => { setIsPlaying(false); setCurrentMoveIdx(moves.length - 1); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6v12l8.5-6zm10 0h2v12h-2z"/>
                </svg>
              </button>
            </div>
            <p className="review-hint">Arrow keys to navigate · Space to play/pause</p>
            {lastMove && (
              <div className="review-coach-section">
                <h3>Move Insight</h3>
                {moveInsightBusy && !moveInsight && <p className="review-report-text">Explaining this move...</p>}
                {!moveInsightBusy && !moveInsight && <p className="review-report-text">Play through the game to see coaching notes for each move.</p>}
                {moveInsight && (
                  <div>
                    <p className="review-report-line"><strong>Advantages:</strong></p>
                    <p className="review-report-text">{moveInsight.thing_1?.summary || moveInsight.narrative?.advantages?.[0] || 'Solid move.'}</p>
                    {(moveInsight.thing_1?.reasons || moveInsight.narrative?.advantages || []).slice(0, 3).map((r, i) => (
                      <p key={i} className="review-report-text">* {typeof r === 'string' ? r : JSON.stringify(r)}</p>
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
          )}
          {moves.length > 0 && (
            <div className="review-coach-section" ref={reportRef}>
              <div className="report-head">
                <div>
                  <p className="review-kicker">Coach Report</p>
                  <h3>{reportData?.opening || 'Full game analysis'}</h3>
                </div>
                {reportData && (
                  <span className="report-grade">{reportData.grade} · {accuracyLetter(reportData.accuracy)}</span>
                )}
              </div>
              {coachError && <div className="alert alert-error">{coachError}</div>}
              <div className="review-coach-buttons">
                <button className="btn btn-primary" onClick={generateReport} disabled={reportBusy || !moves.length}>
                  {reportBusy ? 'Generating...' : reportData ? 'Regenerate report' : 'Full Report'}
                </button>
                {reportData && (
                  <button className="btn btn-secondary" onClick={downloadPdf} disabled={pdfBusy}>
                    {pdfBusy ? 'Preparing PDF...' : 'Download PDF'}
                  </button>
                )}
              </div>
              {!reportData && !reportBusy && (
                <p className="review-report-text">Generate the full report for per-color accuracy, grades, weaknesses, training plan and every move graded.</p>
              )}
              {reportData && (
                <div className="review-report card">
                  <div className="report-acc-grid">
                    <div className="report-acc">
                      <span className="report-acc-label">White</span>
                      <strong className="mono">{Math.round((reportData.accuracy_white ?? accW ?? 0) * 10) / 10}%</strong>
                      <span className="report-acc-grade">{reportData.grade_white || accuracyLetter(reportData.accuracy_white)}</span>
                      <div className="accuracy-bar-track"><div className="accuracy-bar-fill" style={{ width: `${reportData.accuracy_white ?? 0}%` }} /></div>
                    </div>
                    <div className="report-acc">
                      <span className="report-acc-label">Black</span>
                      <strong className="mono">{Math.round((reportData.accuracy_black ?? accB ?? 0) * 10) / 10}%</strong>
                      <span className="report-acc-grade">{reportData.grade_black || accuracyLetter(reportData.accuracy_black)}</span>
                      <div className="accuracy-bar-track"><div className="accuracy-bar-fill" style={{ width: `${reportData.accuracy_black ?? 0}%` }} /></div>
                    </div>
                  </div>
                  <p className="review-report-line"><strong>Overall:</strong> {Math.round((reportData.accuracy || 0) * 10) / 10}% · {reportData.grade}</p>
                  <p className="review-report-line"><strong>Style:</strong> {reportData.style}</p>
                  {reportData.summary_text && <p className="review-report-text">{reportData.summary_text}</p>}
                  {reportData.summary_counts && (
                    <div className="report-counts">
                      {CLASS_ORDER.map((k) => (
                        <span key={k} className="report-count">
                          <span className={`badge badge-${k}`}>{k}</span>
                          <strong className="mono">{reportData.summary_counts[k] ?? 0}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                  {strongStats && (
                    <div className="report-strong">
                      <p className="review-report-line"><strong>Your strong moves</strong></p>
                      <p className="review-report-text">
                        {strongStats.pct !== null
                          ? `${strongStats.pct}% strong (${strongStats.strong}/${strongStats.total})`
                          : 'No moves recorded'}
                      </p>
                    </div>
                  )}
                  {reportData.weaknesses?.length > 0 && (
                    <div>
                      <h4>Weaknesses</h4>
                      {reportData.weaknesses.map((w, i) => <p key={i} className="review-report-text">* {w}</p>)}
                    </div>
                  )}
                  {reportData.training_plan?.length > 0 && (
                    <div>
                      <h4>Training Plan</h4>
                      {reportData.training_plan.map((t, i) => (
                        <div key={i} className="report-plan">
                          <p className="review-report-line"><strong>{typeof t === 'string' ? t : t.topic}{typeof t !== 'string' && t.daily_minutes ? ` · ${t.daily_minutes} min/day` : ''}</strong></p>
                          {typeof t !== 'string' && t.advice && <p className="review-report-text">{t.advice}</p>}
                          {typeof t !== 'string' && t.exercise && <p className="review-report-text"><em>{t.exercise}</em></p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {reportData.opening_recommendations?.length > 0 && (
                    <div>
                      <h4>Opening Recommendations</h4>
                      {reportData.opening_recommendations.map((o, i) => (
                        <p key={i} className="review-report-text">* {typeof o === 'string' ? o : o.opening || JSON.stringify(o)}</p>
                      ))}
                    </div>
                  )}
                  {reportData.moves?.length > 0 && (
                    <div>
                      <h4>Every move</h4>
                      <div className="report-moves">
                        <div className="report-moves-head"><span>#</span><span>Move</span><span>Quality</span><span>CP</span><span>Acc</span></div>
                        {reportData.moves.map((m, i) => {
                          const cls = normalizeClassification(m.classification);
                          const meta = CLASSIFICATION_META[cls];
                          return (
                            <button key={i} className="report-move-row" onClick={() => { setIsPlaying(false); setCurrentMoveIdx(Math.min(i, moves.length - 1)); }}>
                              <span className="mono">{m.move_number}</span>
                              <strong>{m.move || m.san}</strong>
                              <span style={{ color: meta.color }}>{meta.label}</span>
                              <span className="mono">{Math.round(m.cp_loss ?? 0)}</span>
                              <span className="mono">{Math.round(m.accuracy_score ?? 100)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <h4 style={{ marginTop: '18px' }}>Position Tools</h4>
              <div className="review-coach-buttons">
                <button className="btn btn-secondary" onClick={analyzePosition} disabled={posBusy || !moves.length}>
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
            <MoveList moves={mergedMoves} activeIndex={currentMoveIdx} onMoveClick={(idx) => { setIsPlaying(false); setCurrentMoveIdx(idx); }} />
          </div>
          <div className="review-actions card">
            <Link to="/history" className="btn btn-secondary" style={{width:'100%',marginBottom:'8px'}}>Match History</Link>
            {game?.mode === 'friend' && (playerColor === 'white' ? game?.black_username : game?.white_username) && (
              <button
                className="btn btn-secondary"
                style={{width:'100%',marginBottom:'8px'}}
                disabled={rematchBusy}
                onClick={handleRematch}
              >
                {rematchBusy ? 'Starting...' : '⚔ Rematch Friend'}
              </button>
            )}
            <Link to="/lobby" className="btn btn-primary" style={{width:'100%'}}>New Game</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
