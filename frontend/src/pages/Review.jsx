import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { gamesApi, coachApi, reportApi, friendsApi } from '../lib/api';
import { buildPositions, buildPgn, formatEval, loadGameLog, moveRecordToSquares, normalizeClassification, accuracyLetter, CLASSIFICATION_META } from '../lib/chessUtils';
import { moveCacheKey, getCachedMove, setCachedMove } from '../lib/reviewCache';
import Board2D from '../components/board/Board2D';
import MoveList from '../components/game/MoveList';
import GameSummaryCard from '../components/game/GameSummaryCard';
import AiTierBadge from '../components/shared/AiTierBadge';
import { useAuthStore } from '../store/authStore';
import { useCurriculumStore } from '../store/curriculumStore';

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
  const [coachError, setCoachError] = useState(null);
  const [moveInsight, setMoveInsight] = useState(null);
  const [moveInsightBusy, setMoveInsightBusy] = useState(false);
  const [movePosition, setMovePosition] = useState(null);
  const [copied, setCopied] = useState(false);
  const [rematchBusy, setRematchBusy] = useState(false);
  const reportRef = useRef(null);
  const insightCache = useRef(new Map());
  const currentMoveIdxRef = useRef(currentMoveIdx);
  currentMoveIdxRef.current = currentMoveIdx;

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
  const rematchTarget = useMemo(() => {
    if (game?.mode !== 'friend') return null;
    let me = null;
    try {
      me = useAuthStore.getState().user;
    } catch (_) {
      me = null;
    }
    if (me?.id && game?.white_id && game.white_id === me.id) return game.black_username || null;
    if (me?.id && game?.black_id && game.black_id === me.id) return game.white_username || null;
    const fallback = playerColor === 'white' ? game?.black_username : game?.white_username;
    if (me?.username && fallback === me.username) return null;
    return fallback || null;
  }, [game, playerColor]);

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

  const clusters = useCurriculumStore((s) => s.clusters);
  const matchedCluster = useMemo(() => {
    if (!clusters || clusters.length === 0 || !mergedMoves.length) return null;
    const mistakesCount = mergedMoves.filter((m) => {
      const k = normalizeClassification(m.classification);
      return k === 'mistake' || k === 'blunder';
    }).length;
    if (mistakesCount === 0) return null;
    return { cluster: clusters[0], count: mistakesCount };
  }, [clusters, mergedMoves]);

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
    if (rematchBusy || !rematchTarget) return;
    setRematchBusy(true);
    setCoachError(null);
    try {
      await friendsApi.challenge(
        rematchTarget,
        game?.time_control_seconds ?? 600,
        game?.increment_seconds ?? 0
      );
      navigate('/friends');
    } catch (err) {
      setCoachError(err.message || 'Rematch challenge failed');
      setRematchBusy(false);
    }
  }, [rematchBusy, rematchTarget, game, navigate]);

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
    setMoveInsight(null);
    setMovePosition(null);
    if (currentMoveIdx < 0 || !moves[currentMoveIdx]?.uci) return;
    const fenBefore = fens[currentMoveIdx];
    const fenAfter = fens[currentMoveIdx + 1];
    const uci = moves[currentMoveIdx].uci;
    if (!fenBefore || !fenAfter || !uci) return;
    const memKey = `${fenBefore}|${uci}`;
    const storeKey = moveCacheKey(id, currentMoveIdx);
    if (insightCache.current.has(memKey)) {
      const hit = insightCache.current.get(memKey);
      setMoveInsight(hit.insight || null);
      setMovePosition(hit.position || null);
      return;
    }
    let cancelled = false;
    setMoveInsightBusy(true);
    const t = setTimeout(async () => {
      try {
        const cached = await getCachedMove(storeKey).catch(() => null);
        if (cancelled) return;
        if (cached) {
          insightCache.current.set(memKey, cached);
          setMoveInsight(cached.insight || null);
          setMovePosition(cached.position || null);
        } else {
          const [insight, position] = await Promise.all([
            coachApi.explain(fenBefore, uci, null, 0, null),
            coachApi.position(fenAfter),
          ]);
          if (cancelled) return;
          const entry = {};
          if (insight && !insight.error) entry.insight = insight;
          if (position && !position.error) entry.position = position;
          insightCache.current.set(memKey, entry);
          setCachedMove(storeKey, entry).catch(() => { });
          setMoveInsight(entry.insight || null);
          setMovePosition(entry.position || null);
        }
      } catch (_) {
      } finally {
        if (!cancelled) setMoveInsightBusy(false);
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [currentMoveIdx, moves, fens, id]);

  useEffect(() => {
    if (!moveInsight || !moveInsight.narrative?.pending_upgrade || currentMoveIdx < 0) return;
    const curIdx = currentMoveIdx;
    const fenBefore = fens[curIdx] || 'start';
    const move = moves[curIdx];
    const uci = move ? `${move.from}${move.to}${move.promotion || ''}` : null;
    if (!uci) return;
    let active = true;

    const interval = setInterval(async () => {
      try {
        const res = await coachApi.explain(fenBefore, uci, null, 0, null);
        if (!active) return;
        if (res && res.narrative && (!res.narrative.pending_upgrade || res.narrative.source_tier !== 'T4')) {
          if (currentMoveIdxRef.current === curIdx) {
            setMoveInsight(res);
          }
          const memKey = `${id || 'live'}:${curIdx}:${uci}`;
          const currentEntry = insightCache.current.get(memKey) || {};
          currentEntry.insight = res;
          insightCache.current.set(memKey, currentEntry);
          const storeKey = `${id || 'live'}:${curIdx}:${uci}`;
          setCachedMove(storeKey, currentEntry).catch(() => {});
          clearInterval(interval);
        }
      } catch (_) {}
    }, 1500);

    const timer = setTimeout(() => {
      clearInterval(interval);
    }, 55000);

    return () => {
      active = false;
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [moveInsight, currentMoveIdx, moves, fens, id]);

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
          {matchedCluster && (
            <div
              style={{
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                borderRadius: 12,
                padding: '14px 20px',
                margin: '16px 0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '1.3rem' }}>🎯</span>
                <span style={{ fontSize: '0.92rem', color: '#e2e8f0' }}>
                  {matchedCluster.count} of your mistakes match your known{' '}
                  <strong style={{ color: '#38bdf8' }}>{matchedCluster.cluster.display_name}</strong> weakness.
                </span>
              </div>
              <Link
                to="/learn?tab=curriculum"
                className="btn-neon interactive"
                style={{ padding: '6px 14px', fontSize: '0.85rem' }}
              >
                Practice Weakness →
              </Link>
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
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                  </svg>
                </button>
                <button
                  className="btn btn-secondary review-nav-btn"
                  title="Prev"
                  aria-label="Previous move"
                  onClick={() => step(-1)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18 18l-9-6 9-6v12z" />
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
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
                      <path d="M8 5v14l11-7z" />
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
                    <path d="M6 6l9 6-9 6V6z" />
                  </svg>
                </button>
                <button
                  className="btn btn-secondary review-nav-btn"
                  title="End"
                  aria-label="Last move"
                  onClick={() => { setIsPlaying(false); setCurrentMoveIdx(moves.length - 1); }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 6v12l8.5-6zm10 0h2v12h-2z" />
                  </svg>
                </button>
              </div>
              <p className="review-hint">Arrow keys to navigate · Space to play/pause</p>
              {lastMove && (
                <div className="review-coach-section">
                  <h3>Move Insight</h3>
                  {moveInsightBusy && !moveInsight && !movePosition && <p className="review-report-text">Analyzing this move...</p>}
                  {!moveInsightBusy && !moveInsight && !movePosition && <p className="review-report-text">Play through the game to see coaching notes for each move.</p>}
                  {(moveInsight || movePosition) && (
                    <div>
                      {moveInsight && (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <p className="review-report-line" style={{ margin: 0 }}><strong>Advantages:</strong></p>
                            <AiTierBadge tier={moveInsight.narrative?.source_tier} source={moveInsight.narrative?.source_label || moveInsight.narrative?.source} pending={moveInsight.narrative?.pending_upgrade} />
                          </div>
                          {(moveInsight.thing_1?.reasons || moveInsight.narrative?.advantages || []).slice(0, 3).map((r, i) => (
                            <p key={i} className="review-report-text">• {typeof r === 'string' ? r : JSON.stringify(r)}</p>
                          ))}
                          <p className="review-report-line" style={{ marginTop: 8 }}><strong>Disadvantages:</strong></p>
                          {(moveInsight.thing_2?.reasons_to_avoid || moveInsight.narrative?.disadvantages || []).slice(0, 3).map((r, i) => (
                            <p key={i} className="review-report-text">• {r}</p>
                          ))}
                          {(!moveInsight.thing_2?.reasons_to_avoid?.length && !moveInsight.narrative?.disadvantages?.length) && (
                            <p className="review-report-text">• No significant defects.</p>
                          )}
                          {moveInsight.best_move?.san && (
                            <p className="review-report-text" style={{ marginTop: 8 }}>
                              <strong>Best was:</strong> {moveInsight.best_move.san}
                            </p>
                          )}
                        </div>
                      )}
                      {movePosition && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <p className="review-report-line" style={{ margin: 0 }}><strong>Position after:</strong> {formatEval(movePosition.net_score_centipawns)} · {movePosition.game_phase}</p>
                            {movePosition.narrative && (
                              <AiTierBadge tier={movePosition.narrative?.source_tier} source={movePosition.narrative?.source_label || movePosition.narrative?.source} />
                            )}
                          </div>
                          {movePosition.verdict && <p className="review-report-text">{movePosition.verdict}</p>}
                          {(movePosition.strategic_insights || []).slice(0, 2).map((s, i) => (
                            <p key={i} className="review-report-text">* {s}</p>
                          ))}
                        </div>
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
            </div>
          )}        </div>
        <div className="review-sidebar">
          <div className="move-list-container card">
            <MoveList moves={mergedMoves} activeIndex={currentMoveIdx} onMoveClick={(idx) => { setIsPlaying(false); setCurrentMoveIdx(idx); }} />
          </div>
          <div className="review-actions card">
            <Link to="/history" className="btn btn-secondary" style={{ width: '100%', marginBottom: '8px' }}>Match History</Link>
            {rematchTarget && (
              <button
                className="btn btn-secondary"
                style={{ width: '100%', marginBottom: '8px' }}
                disabled={rematchBusy}
                onClick={handleRematch}
                title="Send a rematch challenge"
              >
                {rematchBusy ? 'Sending...' : '⚔ Rematch Friend'}
              </button>
            )}
            <Link to="/lobby" className="btn btn-primary" style={{ width: '100%' }}>New Game</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
