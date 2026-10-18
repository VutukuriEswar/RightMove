import { useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import { useSessionStore } from '../store/sessionStore';
import { createGameSocket } from '../lib/api';
import { saveGameLog } from '../lib/chessUtils';
import { getTabId, readRegistry, isFresh } from '../lib/gameSession';

export function useGameSocket(gameId) {
  const token = useAuthStore((s) => s.token);
  const { applyMove, updateClocks, setResult, setTrainingAnalysis } =
    useGameStore();

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const connect = useCallback(() => {
    if (!gameId || gameId === 'undefined' || !token) return;
    const sess = useSessionStore.getState();
    if (sess.movedAway || sess.idle) return;
    if (!sess.owned) {
      let foreignLive = false;
      try {
        const entry = readRegistry();
        const uid = useAuthStore.getState().user?.id ?? null;
        foreignLive = !!uid && !!entry && isFresh(entry) && entry.tabId !== getTabId() && entry.userId === uid && entry.active;
      } catch (_) {
        foreignLive = false;
      }
      if (foreignLive) {
        sess.setSuspended(true);
        return;
      }
      sess.setOwned(true);
      sess.setSuspended(false);
    }
    const cur = wsRef.current;
    if (cur && (cur.readyState === WebSocket.OPEN || cur.readyState === WebSocket.CONNECTING)) return;

    const ws = createGameSocket(gameId, token);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'game_state':
          if (msg.payload.fen) {
            useGameStore.setState({ gameId, fen: msg.payload.fen });
          } else {
            useGameStore.setState({ gameId });
          }
          if (msg.payload.clocks) updateClocks(msg.payload.clocks);
          if (msg.payload.result && msg.payload.result !== 'ongoing') setResult(msg.payload.result);
          if (msg.payload.moves) {
            const last = msg.payload.moves[msg.payload.moves.length - 1];
            useGameStore.setState({
              moves: msg.payload.moves,
              ...(msg.payload.fen ? { fen: msg.payload.fen } : last?.fen ? { fen: last.fen } : {}),
              ...(msg.payload.can_takeback !== undefined ? { canTakeback: msg.payload.can_takeback } : {}),
              ...(msg.payload.can_redo !== undefined ? { canRedo: msg.payload.can_redo } : {}),
              ...(msg.payload.bot_engine ? { botEngine: msg.payload.bot_engine } : {}),
              ...(msg.payload.bot_depth ? { botDepth: msg.payload.bot_depth } : {}),
              ...(msg.payload.maia_elo ? { maiaElo: msg.payload.maia_elo } : {}),
              ...(msg.payload.player_color ? { playerColor: msg.payload.player_color } : {}),
            });
          }
          break;

        case 'move':
          applyMove(msg.payload);
          useGameStore.setState((s) => ({
            serverError: null,
            canTakeback: s.mode === 'bot' ? true : s.canTakeback,
            canRedo: false,
          }));
          break;

        case 'takeback':
        case 'redo': {
          const { syncPosition } = useGameStore.getState();
          syncPosition(msg.payload.fen, msg.payload.moves, {
            canTakeback: msg.payload.can_takeback,
            canRedo: msg.payload.can_redo,
          });
          useGameStore.setState({ serverError: null });
          break;
        }

        case 'error':
          console.error('[ws] Server error:', msg.payload?.msg);
          useGameStore.setState({ serverError: msg.payload?.msg || 'Server error' });
          break;

        case 'clock':
          updateClocks(msg.payload);
          break;

        case 'training_analysis':
          setTrainingAnalysis(msg.payload);
          break;

        case 'human_move_feedback':
          useGameStore.setState((s) => {
            const feedback = msg.payload;
            // Patch classification into the last non-bot move record
            const updatedMoves = s.moves.map((m, idx) => {
              if (!m.is_bot && idx === s.moves.length - 1) {
                return { ...m, classification: feedback.classification };
              }
              return m;
            });
            return { humanMoveFeedback: feedback, moves: updatedMoves };
          });
          break;

        case 'game_over': {
          const { result: gameResult, moves: gameMoves } = msg.payload;
          setResult(gameResult);
          if (gameMoves?.length) {
            const state = useGameStore.getState();
            saveGameLog(gameId, gameMoves, {
              result:   gameResult,
              mode:     state.mode,
              opponent: state.mode === 'bot' ? 'Coach' : 'Opponent',
              player_color: state.playerColor,
            }).catch(console.error);
          }
          break;
        }

        case 'draw_offer':
          useGameStore.setState({ pendingDrawOffer: msg.payload.from });
          break;

        case 'draw_offer_sent':
          useGameStore.setState({ drawOfferSent: true });
          break;

        case 'draw_declined':
          useGameStore.setState({ drawOfferSent: false, drawDeclinedMsg: msg.payload?.msg || 'Draw offer declined.', drawCooling: true });
          setTimeout(() => useGameStore.setState({ drawDeclinedMsg: null, drawCooling: false }), 10000);
          break;

        case 'both_ready':
          // Both players are ready — signal the game to start
          useGameStore.setState({ bothReady: true });
          break;

        case 'waiting_for_opponent':
          useGameStore.setState({ waitingForOpponent: true });
          break;

        default:
          break;
      }
    };

    ws.onclose = (event) => {
      const sess = useSessionStore.getState();
      if (sess.movedAway || sess.suspended || sess.idle) return;
      const { result } = useGameStore.getState();
      if (!result && event.code < 4000) {
        reconnectTimerRef.current = setTimeout(connect, 2000);
      } else if (event.code >= 4000) {
        console.error(`[ws] Disconnected with terminal code ${event.code}: ${event.reason}`);
      }
    };

    ws.onerror = (err) => {
      console.error('[ws] Game socket error:', err);
    };
  }, [gameId, token, applyMove, updateClocks, setResult, setTrainingAnalysis]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect]);

  const sessionSuspended = useSessionStore((s) => s.suspended);
  const sessionMovedAway = useSessionStore((s) => s.movedAway);

  useEffect(() => {
    if (!sessionSuspended && !sessionMovedAway) return;
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (_) {}
      wsRef.current = null;
    }
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
  }, [sessionSuspended, sessionMovedAway]);

  useEffect(() => {
    if (sessionSuspended || sessionMovedAway || !gameId || !token) return;
    const cur = wsRef.current;
    if (!cur || cur.readyState === WebSocket.CLOSED) connect();
  }, [sessionSuspended, sessionMovedAway, gameId, token, connect]);

  const sendReady = useCallback(() => {
    const send = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ready', payload: {} }));
      }
    };
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send();
    } else {
      setTimeout(send, 400);
    }
  }, []);

  const sendMove = useCallback((uci) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'move', payload: { uci } }));
    }
  }, []);

  const sendResign = useCallback((losingColor) => {
    const payload =
      losingColor === 'white' || losingColor === 'black' ? { color: losingColor } : {};
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resign', payload }));
    }
  }, []);

  const sendDrawOffer = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'draw_offer', payload: {} }));
    }
  }, []);

  const acceptDraw = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'draw_accept', payload: {} }));
    }
  }, []);

  const sendDrawDecline = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'draw_decline', payload: {} }));
    }
  }, []);

  const sendTimeout = useCallback((losingColor) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'timeout', payload: { color: losingColor } }));
    }
  }, []);

  const sendTakeback = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'takeback', payload: {} }));
    }
  }, []);

  const sendRedo = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'redo', payload: {} }));
    }
  }, []);

  const sendBotFirstMove = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'bot_first_move', payload: {} }));
    }
  }, []);

  return { sendReady, sendMove, sendResign, sendDrawOffer, acceptDraw, sendDrawDecline, sendTimeout, sendTakeback, sendRedo, sendBotFirstMove };
}
