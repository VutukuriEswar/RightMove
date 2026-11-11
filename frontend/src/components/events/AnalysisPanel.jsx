import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { broadcastsApi } from '../../lib/api';
import { analysisAttribution } from '../../lib/broadcastUtils';
import WinPercentageChart from './WinPercentageChart';
import WinPercentageExplanations from './WinPercentageExplanations';
import {
  buildWinPercentageGraph,
  generatePositionExplanations,
} from '../../lib/chessAnalysisExplainer';

const POLL_MS = 3500;

export default function AnalysisPanel({
  roundId,
  gameId,
  tourId,
  game,
  isLoggedIn,
  onAnalysisLoaded,
  currentPly = -1,
  onSelectPly,
  boardFen,
  currentMove,
  whiteData,
  blackData,
}) {
  const [state, setState] = useState({ status: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pollTick, setPollTick] = useState(0);
  const onLoadedRef = useRef(onAnalysisLoaded);
  const loadedKeyRef = useRef(null);

  useEffect(() => {
    onLoadedRef.current = onAnalysisLoaded;
  }, [onAnalysisLoaded]);

  const isLiveGame = game?.result === '*';

  useEffect(() => {
    if (!roundId || !gameId) return undefined;
    let alive = true;
    let timer = null;

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const fetchStatus = async () => {
      try {
        const res = await broadcastsApi.analysis(roundId, gameId);
        if (!alive) return;
        setState(res);
        setError(null);

        if (res.analysis) {
          const stamp = res.analysis.updated_at || '';
          const plyCount = res.analysis.ply_count || 0;
          const loadKey = `${roundId}:${gameId}:${stamp}:${plyCount}`;
          if (loadedKeyRef.current !== loadKey) {
            loadedKeyRef.current = loadKey;
            onLoadedRef.current?.(res.analysis);
          }
        }

        if (res.status === 'queued' || res.status === 'running' || isLiveGame) {
          if (!timer) timer = setInterval(fetchStatus, POLL_MS);
        } else {
          stopPolling();
        }
      } catch (e) {
        if (!alive) return;
        setError(e.message || 'Could not load analysis.');
        stopPolling();
      }
    };

    loadedKeyRef.current = null;
    setState({ status: 'idle' });
    setError(null);
    fetchStatus();

    return () => {
      alive = false;
      stopPolling();
    };
  }, [roundId, gameId, game?.moves?.length, isLiveGame, pollTick]);

  const requestAnalysis = useCallback(async () => {
    if (!roundId || !gameId) return;
    setBusy(true);
    setError(null);
    try {
      await broadcastsApi.analyzeGame(roundId, gameId, tourId);
      setState({ status: 'queued' });
      setPollTick((t) => t + 1);
    } catch (e) {
      setError(e.message || 'Could not request analysis.');
    } finally {
      setBusy(false);
    }
  }, [roundId, gameId, tourId]);

  const analysis = state.analysis || (state.status === 'done' ? state.analysis : null);
  const status = state.status || 'idle';
  const whiteName = whiteData?.name || analysis?.headers?.white || game?.white || 'White';
  const blackName = blackData?.name || analysis?.headers?.black || game?.black || 'Black';
  const isImported = String(roundId || '').startsWith('import:');
  const canRequest = !isImported && game?.result !== '*';

  const effectiveMoves = useMemo(() => {
    const rawMoves = game?.moves || [];
    const analyzed = analysis?.moves || [];
    if (!analyzed.length) return rawMoves;
    if (!rawMoves.length) return analyzed;
    if (analyzed.length >= rawMoves.length) return analyzed;
    return rawMoves.map((m, idx) => {
      const a = analyzed[idx];
      return a ? { ...m, ...a } : m;
    });
  }, [analysis, game]);

  const winGraph = useMemo(() => {
    return buildWinPercentageGraph(effectiveMoves, analysis?.eval_graph || []);
  }, [effectiveMoves, analysis?.eval_graph]);

  const activePly = useMemo(() => {
    if (currentPly != null && currentPly >= 0) return currentPly;
    return effectiveMoves.length > 0 ? effectiveMoves.length - 1 : 0;
  }, [currentPly, effectiveMoves]);

  const activeMove = useMemo(() => {
    if (activePly > 0 && activePly <= effectiveMoves.length) {
      return effectiveMoves[activePly - 1];
    }
    return currentMove || (effectiveMoves.length > 0 ? effectiveMoves[effectiveMoves.length - 1] : null);
  }, [activePly, effectiveMoves, currentMove]);

  const currentEvalCp = useMemo(() => {
    if (winGraph.length === 0) return 0;
    const match = winGraph.find((p) => p.ply === activePly);
    if (match && match.evalCp != null) return match.evalCp;
    return winGraph[winGraph.length - 1].evalCp || 0;
  }, [winGraph, activePly]);

  const explanations = useMemo(() => {
    return generatePositionExplanations(
      boardFen,
      currentEvalCp,
      activeMove,
      whiteName,
      blackName
    );
  }, [boardFen, currentEvalCp, activeMove, whiteName, blackName]);

  return (
    <section className="ev-analysis glass-panel">
      <div className="ev-analysis-head">
        <div>
          <p className="ev-kicker">Stockfish Engine · Win Probability</p>
          <h3 className="ev-analysis-title">Live Win Percentage & Position Analysis</h3>
        </div>
        <div className="ev-analysis-head-right">
          {analysis && (
            <span className="ev-attribution">{analysisAttribution(analysis)}</span>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {status === 'missing' && !analysis && effectiveMoves.length === 0 && (
        <div className="ev-analysis-request">
          <p className="ev-empty-note">
            {isImported
              ? 'This PGN is queued for analysis. Check back in a moment.'
              : 'No moves have been played in this game yet.'}
          </p>
          {!isImported && canRequest && (
            isLoggedIn ? (
              <button
                type="button"
                className="btn-neon interactive"
                onClick={requestAnalysis}
                disabled={busy}
              >
                {busy ? 'Requesting…' : 'Analyze this game'}
              </button>
            ) : (
              <p className="ev-login-hint">
                <Link to="/login">Log in</Link> to request engine analysis.
              </p>
            )
          )}
        </div>
      )}

      <div className="ev-analysis-content">
        <WinPercentageChart
          graph={winGraph}
          currentPly={currentPly}
          onSelectPly={onSelectPly}
          whiteName={whiteName}
          blackName={blackName}
        />

        <WinPercentageExplanations
          whiteExplanation={explanations.white}
          blackExplanation={explanations.black}
          whiteTitle={whiteData?.title}
          blackTitle={blackData?.title}
          whiteAvatar={whiteData?.avatar}
          blackAvatar={blackData?.avatar}
          whiteRating={whiteData?.rating}
          blackRating={blackData?.rating}
        />
      </div>

      {isLoggedIn && canRequest && (
        <div className="ev-analysis-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="ev-text-btn interactive"
            onClick={requestAnalysis}
            disabled={busy}
          >
            {busy ? 'Requesting…' : 'Refresh Engine Analysis'}
          </button>
        </div>
      )}
    </section>
  );
}
