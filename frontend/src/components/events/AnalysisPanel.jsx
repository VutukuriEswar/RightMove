import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { broadcastsApi } from '../../lib/api';
import { analysisAttribution } from '../../lib/broadcastUtils';
import GameSummaryCard from '../game/GameSummaryCard';
import EvalChart from './EvalChart';

const POLL_MS = 4000;

export default function AnalysisPanel({
  roundId,
  gameId,
  tourId,
  game,
  isLoggedIn,
  onAnalysisLoaded,
  currentPly = null,
  onSelectPly,
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
        if (res.status === 'done') {
          const stamp = res.analysis?.updated_at || '';
          const loadKey = `${roundId}:${gameId}:${stamp}`;
          if (loadedKeyRef.current !== loadKey) {
            loadedKeyRef.current = loadKey;
            onLoadedRef.current?.(res.analysis);
          }
          if (res.analysis?.finished === false) {
            if (!timer) timer = setInterval(fetchStatus, POLL_MS);
          } else {
            stopPolling();
          }
        } else if (res.status === 'queued' || res.status === 'running') {
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
  }, [roundId, gameId, pollTick]);

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

  const isImported = String(roundId || '').startsWith('import:');
  const analysis = state.status === 'done' ? state.analysis : null;
  const status = state.status || 'idle';
  const whiteName = analysis?.headers?.white || game?.white || 'White';
  const blackName = analysis?.headers?.black || game?.black || 'Black';
  const canRequest = !isImported && game?.result !== '*';

  return (
    <section className="ev-analysis glass-panel">
      <div className="ev-analysis-head">
        <div>
          <p className="ev-kicker">Local Stockfish · free</p>
          <h3 className="ev-analysis-title">Game analysis</h3>
        </div>
        {analysis && (
          <span className="ev-attribution">{analysisAttribution(analysis)}</span>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {(status === 'idle') && (
        <p className="ev-empty-note">Checking for saved analysis…</p>
      )}

      {(status === 'queued' || status === 'running') && (
        <div className="ev-queued">
          <span className="ev-spinner" aria-hidden="true" />
          <div>
            <p className="ev-queued-title">
              {status === 'running' ? 'Stockfish is analysing this game…' : 'Analysis queued…'}
            </p>
            <p className="ev-empty-note">
              This runs in the background. You can keep watching — the result is saved for everyone.
            </p>
          </div>
        </div>
      )}

      {status === 'missing' && (
        <div className="ev-analysis-request">
          <p className="ev-empty-note">
            {isImported
              ? 'This PGN is queued for analysis. Check back in a moment.'
              : 'No analysis has been saved for this game yet.'}
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
                <Link to="/login">Log in</Link> to request a free Stockfish analysis. Once done it is saved for everyone.
              </p>
            )
          )}
        </div>
      )}

      {(status === 'failed' || status === 'skipped') && (
        <div className="ev-analysis-request">
          <p className="ev-empty-note">
            {status === 'skipped'
              ? 'This game has no moves to analyse yet. It will be retried when moves are published.'
              : `The last analysis attempt failed${state.queue?.error ? `: ${state.queue.error}` : '.'}`}
          </p>
          {isLoggedIn && canRequest && (
            <button
              type="button"
              className="btn-neon interactive"
              onClick={requestAnalysis}
              disabled={busy}
            >
              {busy ? 'Requesting…' : 'Try again'}
            </button>
          )}
        </div>
      )}

      {analysis && (
        <>
          {analysis.finished === false && (
            <p className="ev-partial-note">
              Partial analysis — this game is still in progress.
            </p>
          )}
          <GameSummaryCard
            summary={{
              accuracy_white: analysis.accuracy_white,
              accuracy_black: analysis.accuracy_black,
              summary_text: '',
              key_moments: analysis.key_moments || [],
            }}
            whiteUsername={whiteName}
            blackUsername={blackName}
          />
          <div className="ev-eval-section">
            <div className="ev-eval-head">
              <h4>Evaluation</h4>
              <span className="ev-empty-note">
                {analysis.ply_count ? `${analysis.ply_count} plies` : ''}
              </span>
            </div>
            <EvalChart
              graph={analysis.eval_graph}
              currentPly={currentPly}
              onSelectPly={onSelectPly}
            />
          </div>
          {isLoggedIn && canRequest && (
            <button
              type="button"
              className="ev-text-btn interactive"
              onClick={requestAnalysis}
              disabled={busy}
            >
              {busy ? 'Requesting…' : 'Analyze again'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
