import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { useBoardThemeStore } from '../store/boardThemeStore';
import { useGameSocket } from '../hooks/useGameSocket';
import { useLeaveGameGuard } from '../hooks/useLeaveGameGuard';
import { useLeaveGameStore } from '../store/leaveGameStore';
import { setActiveGameResigner, clearActiveGameResigner } from '../lib/activeGameResign';
import Board2D from '../components/board/Board2D';
import Board3D from '../components/board/Board3D';
import Clock from '../components/game/Clock';
import MoveList from '../components/game/MoveList';
import CoachPanel from '../components/game/CoachPanel';
import PlaySidebar from '../components/game/PlaySidebar';
import { gamesApi, friendsApi } from '../lib/api';
import { moveRecordToSquares } from '../lib/chessUtils';
import { savePassPlaySnapshot, loadPassPlaySnapshot, clearPassPlaySnapshot } from '../lib/passPlayPersist';

export default function GameRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { sendReady, sendMove, sendResign, sendDrawOffer, acceptDraw, sendTimeout, sendTakeback, sendRedo, sendBotFirstMove } = useGameSocket(id);
  const { style: boardStyle, setStyle } = useBoardThemeStore();
  const boardFlipped = useGameStore((s) => s.boardFlipped);
  const opponentUsername = useGameStore((s) => s.opponentUsername);

  const {
    fen,
    moves,
    clocks,
    result,
    playerColor,
    mode: gameMode,
    trainingMode,
    pendingDrawOffer,
    drawOfferSent,
    drawDeclinedMsg,
    bothReady,
    waitingForOpponent,
    hasTimer,
    serverError,
    initGame,
  } = useGameStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [friendReqSent, setFriendReqSent] = useState(false);

  const resignAndClose = useCallback(() => {
    const st = useGameStore.getState();
    if (!st.gameId || st.result) return;
    const loser =
      st.mode === 'pass_and_play'
        ? (st.fen.split(' ')[1] === 'w' ? 'white' : 'black')
        : st.playerColor;
    try {
      sendResign(loser);
    } catch (_) {

    }
    useGameStore.getState().setResult(loser === 'white' ? 'black' : 'white');
  }, [sendResign]);

  const resignForLeave = useCallback(() => {
    const st = useGameStore.getState();
    if (!st.gameId || st.result) return;
    useLeaveGameStore.getState().setLeaving(true);
    const loser =
      st.mode === 'pass_and_play'
        ? (st.fen.split(' ')[1] === 'w' ? 'white' : 'black')
        : st.playerColor;
    try {
      sendResign(loser);
    } catch (_) {

    }
  }, [sendResign]);

  const leaving = useLeaveGameStore((s) => s.leaving);

  const leaveGameBlocker = useLeaveGameGuard(resignForLeave);

  useEffect(() => {
    useLeaveGameStore.getState().setLeaving(false);
    setActiveGameResigner(resignForLeave);
    return () => {
      clearActiveGameResigner(resignForLeave);
      useLeaveGameStore.getState().setLeaving(false);
    };
  }, [resignForLeave]);

  const [showReadyModal, setShowReadyModal] = useState(false);
  const [playersReady, setPlayersReady] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [passPlayResignColor, setPassPlayResignColor] = useState(null);

  const [showResumeModal, setShowResumeModal] = useState(false);
  const [startingNew, setStartingNew] = useState(false);
  const resumeDecidedRef = useRef(false);
  const timeControlRef = useRef({ tc: 600, inc: 0 });

  const FLIP_DURATION = 700;
  const [isFlipping, setIsFlipping] = useState(false);
  const prevActiveColorRef = useRef(null);
  const flipTimerRef = useRef(null);

  useEffect(() => {
    if (moves.length > 0 && showReadyModal && !showResumeModal) {
      setPlayersReady(true);
      setShowReadyModal(false);
      sendReady();
    }
  }, [moves.length, showReadyModal, showResumeModal, sendReady]);

  useEffect(() => {
    if (bothReady && !playersReady) {
      setPlayersReady(true);
      setShowReadyModal(false);
    }
  }, [bothReady, playersReady]);

  useEffect(() => {
    if (gameMode !== 'pass_and_play' || !playersReady || !gameActive) return;
    const cur = fen.split(' ')[1] === 'w' ? 'white' : 'black';
    if (prevActiveColorRef.current !== null && prevActiveColorRef.current !== cur) {

      if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
      setIsFlipping(true);
      flipTimerRef.current = setTimeout(() => setIsFlipping(false), FLIP_DURATION);
    }
    prevActiveColorRef.current = cur;

  }, [fen, gameMode, playersReady, gameActive]);

  useEffect(() => () => { if (flipTimerRef.current) clearTimeout(flipTimerRef.current); }, []);

  useEffect(() => {
    if (result && !useLeaveGameStore.getState().leaving) {
      setShowGameOver(true);
    }
  }, [result]);

  useEffect(() => {
    let cancelled = false;
    gamesApi.get(id)
      .then(game => {
        if (cancelled) return;

        const userId = useAuthStore.getState().user?.id;
        let color = 'white';
        if (game.mode === 'bot') {
          color = game.player_color || color;
          if (!game.player_color && game.white_id && userId) {
            color = game.white_id === userId ? 'white' : 'black';
          }
        } else if (game.mode !== 'pass_and_play' && game.white_id && userId) {
          color = game.white_id === userId ? 'white' : 'black';
        }

        const timeControlMs = (game.time_control_seconds ?? 600) * 1000;
        timeControlRef.current = {
          tc: game.time_control_seconds ?? 600,
          inc: game.increment_seconds ?? 0,
        };

        const trainingMode = game.training_mode ?? (game.mode === 'bot');

        initGame(game.id, game.mode, color, timeControlMs, trainingMode, {
          botEngine: game.bot_engine ?? null,
          botDepth: game.bot_depth ?? null,
          maiaElo: game.maia_elo ?? null,
        });

        if (game.mode === 'random' || game.mode === 'friend') {
          const oppUsername = color === 'white' ? game.black_username : game.white_username;
          useGameStore.setState({ opponentUsername: oppUsername ?? null });
        }

        useGameStore.setState({
          botEngine: game.bot_engine ?? useGameStore.getState().botEngine,
          botDepth: game.bot_depth ?? useGameStore.getState().botDepth,
          maiaElo: game.maia_elo ?? useGameStore.getState().maiaElo,
        });

        if (game.result && game.result !== 'ongoing') {
          useGameStore.getState().setResult(game.result);
          setLoading(false);
          return;
        }

        if (game.mode === 'bot') {

          setPlayersReady(true);
          sendReady();
        } else if (game.mode === 'pass_and_play') {

          const snap = loadPassPlaySnapshot(id);
          const restoredMoves = useGameStore.getState().moves.length;
          if (snap && snap.moveCount > 0 && restoredMoves > 0) {
            setShowResumeModal(true);
          } else {
            setShowReadyModal(true);
          }
        } else {

          setShowReadyModal(true);
        }
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, initGame, sendReady]);

  useEffect(() => {
    if (gameMode !== 'pass_and_play' || resumeDecidedRef.current) return;
    if (result || moves.length === 0) return;
    if (showResumeModal || playersReady) return;
    const snap = loadPassPlaySnapshot(id);
    if (snap && snap.moveCount > 0) {
      setShowReadyModal(false);
      setShowResumeModal(true);
    }
  }, [gameMode, moves.length, result, showResumeModal, playersReady, id]);

  useEffect(() => {
    if (gameMode !== 'pass_and_play' || !id) return;
    if (result) {
      clearPassPlaySnapshot(id);
      return;
    }
    if (moves.length === 0) return;
    savePassPlaySnapshot(id, {
      fen,
      moves,
      clocks,
      timeControlMs: timeControlRef.current.tc * 1000,
    });
  }, [gameMode, id, fen, moves, clocks, result]);

  const handleMove = (uci) => {
    sendMove(uci);
  };

  const handleReady = () => {
    if (isPassAndPlay) {
      setPlayersReady(true);
      setShowReadyModal(false);
    } else {
      useGameStore.setState({ waitingForOpponent: true });
    }
    sendReady();
  };

  const handleResumeContinue = () => {
    resumeDecidedRef.current = true;
    setShowResumeModal(false);
    setPlayersReady(true);
    sendReady();
  };

  const handleResumeNew = async () => {
    resumeDecidedRef.current = true;
    setStartingNew(true);
    clearPassPlaySnapshot(id);
    try {

      resignAndClose();
      const { id: newId } = await gamesApi.create({
        mode: 'pass_and_play',
        time_control_seconds: timeControlRef.current.tc,
        increment_seconds: timeControlRef.current.inc,
      });
      navigate(`/game/${newId}`);
    } catch (err) {
      setError(err.message || 'Failed to start a new game');
      setStartingNew(false);
      setShowResumeModal(false);
      setShowReadyModal(true);
    }
  };

  if (loading) return <div className="page"><div className="spinner-large" /></div>;
  if (error) return <div className="page"><div className="alert alert-error">{error}</div></div>;

  const activeColor = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const isPassAndPlay = gameMode === 'pass_and_play';

  const isPlayerTurn = isPassAndPlay ? true : (activeColor === playerColor);
  const gameActive = result === null;
  const lastMoveRecord = moves.length > 0 ? moves[moves.length - 1] : null;
  const lastMove = moveRecordToSquares(lastMoveRecord);

  const whiteClock = clocks.white ?? 600000;
  const blackClock = clocks.black ?? 600000;

  const viewColor = isPassAndPlay ? activeColor : (boardFlipped ? (playerColor === 'white' ? 'black' : 'white') : playerColor);
  const boardOrientation = isPassAndPlay ? activeColor : viewColor;

  const bottomColor = boardOrientation;
  const topColor = bottomColor === 'white' ? 'black' : 'white';

  const myClock = bottomColor === 'white' ? whiteClock : blackClock;
  const theirClock = topColor === 'white' ? whiteClock : blackClock;

  const myClockActive = gameActive && playersReady && activeColor === bottomColor && !isFlipping;
  const theirClockActive = gameActive && playersReady && activeColor === topColor && !isFlipping;

  const topIsActive = gameActive && playersReady && !showResumeModal && activeColor === topColor;
  const bottomIsActive = gameActive && playersReady && !showResumeModal && activeColor === bottomColor;

  const isEngineGame = gameMode === 'bot';
  const handleTheirTimeout = (!isEngineGame && hasTimer) ? () => sendTimeout(topColor) : undefined;
  const handleMyTimeout = (!isEngineGame && hasTimer) ? () => sendTimeout(bottomColor) : undefined;

  const showClocks = !isEngineGame && hasTimer;

  const myLabel = isPassAndPlay ? (bottomColor === 'white' ? 'White' : 'Black') : 'You';
  const theirLabel = isPassAndPlay
    ? (topColor === 'white' ? 'White' : 'Black')
    : (opponentUsername || 'Opponent');

  const boardDisabled = !gameActive || !isPlayerTurn || !playersReady || isFlipping;

  const readyModalPortal = showReadyModal && createPortal(
    <div className="ready-modal-overlay">
      <div className="ready-modal">
        <div className="ready-modal-crest">♔</div>
        <h2>Prepare for Battle</h2>
        <p>
          {isPassAndPlay
            ? 'Ensure both players are seated. The clock will begin upon your command.'
            : waitingForOpponent
              ? 'Waiting for your opponent to connect…'
              : 'Take your position. The match is about to begin.'}
        </p>
        {!waitingForOpponent ? (
          <button
            className="btn-neon interactive"
            style={{ width: '100%', padding: '14px 0', fontSize: '0.9rem' }}
            onClick={handleReady}
          >
            {isPassAndPlay ? '⚔ We Are Ready' : '⚔ I Am Ready'}
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center', marginTop: '8px' }}>
            <span className="spinner" />
            <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>Waiting for opponent…</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );

  const resumeModalPortal = showResumeModal && gameActive && createPortal(
    <div className="ready-modal-overlay">
      <div className="ready-modal">
        <div className="ready-modal-crest">♞</div>
        <h2>Resume Battle?</h2>
        <p>
          A pass &amp; play match is already in progress
          ({moves.length} {moves.length === 1 ? 'move' : 'moves'} played).
          Continue it or start a fresh board with the same time control?
        </p>
        <div className="modal-btn-row">
          <button
            className="btn-neon interactive"
            style={{ flex: 1, padding: '12px 0' }}
            onClick={handleResumeContinue}
          >
            Continue Match
          </button>
          <button
            className="btn-neon interactive"
            style={{ flex: 1, padding: '12px 0', background: 'transparent', borderColor: 'var(--royal-gold)', color: 'var(--royal-gold)' }}
            onClick={handleResumeNew}
            disabled={startingNew}
          >
            {startingNew ? 'Starting…' : 'New Game'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );

  const drawModalPortal = pendingDrawOffer && gameActive && createPortal(
    <div className="ready-modal-overlay">
      <div className="ready-modal">
        <div className="ready-modal-crest">🤝</div>
        <h2>Draw Offered</h2>
        <p>Your opponent has offered a draw. Do you accept?</p>
        <div className="modal-btn-row">
          <button
            className="btn-neon interactive"
            style={{ flex: 1, padding: '12px 0' }}
            onClick={() => {
              acceptDraw();
              useGameStore.setState({ pendingDrawOffer: null });
            }}
          >
            Accept
          </button>
          <button
            className="btn-neon interactive"
            style={{ flex: 1, padding: '12px 0', background: 'transparent', borderColor: 'var(--royal-crimson)', color: 'var(--royal-crimson)' }}
            onClick={() => useGameStore.setState({ pendingDrawOffer: null })}
          >
            Decline
          </button>
        </div>
      </div>
    </div>,
    document.body
  );

  const gameOverTitle =
    result === 'draw' ? 'Game Drawn'
      : result === 'white' ? 'White Wins!'
        : result === 'black' ? 'Black Wins!'
          : result === 'aborted' ? 'Game Aborted'
            : 'Game Over';
  const gameOverModalPortal = !gameActive && showGameOver && !leaving && createPortal(
    <div className="ready-modal-overlay">
      <div className="ready-modal">
        <div className="ready-modal-crest">{result === 'draw' ? '½-½' : '♚'}</div>
        <h2 style={{ color: result === 'draw' ? 'var(--royal-ink)' : 'var(--royal-gold)' }}>
          {gameOverTitle}
        </h2>
        <p>The battle has concluded.</p>
        <div className="modal-btn-row">
          <button
            className="btn-neon interactive"
            style={{ flex: 1, padding: '12px 0' }}
            onClick={() => navigate(`/review/${id}`)}
          >
            Review Match
          </button>
          {isEngineGame && (
            <button
              className="btn-neon interactive"
              style={{ flex: 1, padding: '12px 0', background: 'transparent', borderColor: 'var(--royal-gold)', color: 'var(--royal-gold)' }}
              onClick={() => navigate(`/review/${id}?report=1`)}
            >
              Full Report
            </button>
          )}
          <button
            className="btn-neon interactive"
            style={{ flex: 1, padding: '12px 0', background: 'transparent', borderColor: 'var(--royal-brass)', color: 'var(--royal-brass)' }}
            onClick={() => navigate('/lobby')}
          >
            Go Home
          </button>
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <>

      {leaveGameBlocker}

      {readyModalPortal}
      {resumeModalPortal}
      {drawModalPortal}
      {gameOverModalPortal}

      <div aria-live="polite" className="sr-only">
        {gameActive && playersReady ? `${activeColor === 'white' ? 'White' : 'Black'} to move` : ''}
      </div>

      <motion.div
        className="game-room"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="game-layout">

          {isEngineGame && (
            <div className="game-leftbar">
              <PlaySidebar fen={fen} onBotFirst={sendBotFirstMove} onTakeback={sendTakeback} onRedo={sendRedo} />
            </div>
          )}

          <div className="game-board-area">
            <div
              className={`board-column${isPassAndPlay && isFlipping ? ' board-flip-anim' : ''}`}
            >

              <div className={`player-info top${theirClockActive ? ' active-turn' : ''}`}>
                <div className="player-info-left">
                  <div className="player-avatar">{theirLabel.charAt(0).toUpperCase()}</div>
                  <span className="player-name">{theirLabel}</span>
                  {topIsActive && <span className="turn-badge"><span className="turn-dot" />TO MOVE</span>}
                </div>
                <div className="player-info-right">
                  {!isPassAndPlay && !isEngineGame && opponentUsername && (
                    <button
                      className="btn-sm interactive"
                      style={{
                        fontSize: '0.7rem', padding: '4px 8px', marginRight: '8px',
                        background: friendReqSent ? 'transparent' : undefined,
                        borderColor: friendReqSent ? 'var(--royal-gold)' : undefined,
                        color: friendReqSent ? 'var(--royal-gold)' : undefined
                      }}
                      disabled={friendReqSent}
                      title={friendReqSent ? 'Friend request sent!' : `Add ${opponentUsername} as friend`}
                      onClick={async () => {
                        try {
                          await friendsApi.sendRequest(opponentUsername);
                          setFriendReqSent(true);
                        } catch (e) {

                        }
                      }}
                    >
                      {friendReqSent ? '✓ Requested' : '+ Add Friend'}
                    </button>
                  )}
                  {showClocks && (
                    <Clock ms={theirClock} active={theirClockActive} onTimeout={handleTheirTimeout} />
                  )}
                </div>
              </div>

              {serverError && (
                <div className="alert alert-error" style={{ marginBottom: '8px' }}>
                  {serverError}
                  <button
                    className="btn-sm"
                    style={{ marginLeft: '8px' }}
                    onClick={() => useGameStore.setState({ serverError: null })}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div className="board-sizer">
                {boardStyle === '3d' ? (
                  <Board3D
                    fen={fen}
                    playerColor={boardOrientation}
                    onMove={handleMove}
                    disabled={boardDisabled}
                    lastMove={lastMove}
                    onFallbackTo2D={() => setStyle('2d')}
                  />
                ) : (
                  <Board2D
                    id="gameBoard"
                    fen={fen}
                    playerColor={boardOrientation}
                    onMove={handleMove}
                    disabled={boardDisabled}
                    lastMove={lastMove}
                    isFlipping={isFlipping}
                  />
                )}
              </div>

              <div className={`player-info bottom${myClockActive ? ' active-turn' : ''}`}>
                <div className="player-info-left">
                  <div className="player-avatar" style={{ background: 'linear-gradient(135deg, #3d2a00, #1a1000)' }}>
                    {myLabel.charAt(0)}
                  </div>
                  <span className="player-name" style={{ color: 'var(--royal-gold, #D4AF37)' }}>{myLabel}</span>
                  {bottomIsActive && <span className="turn-badge"><span className="turn-dot" />TO MOVE</span>}
                </div>
                <div className="player-info-right">
                  {showClocks && (
                    <Clock ms={myClock} active={myClockActive} onTimeout={handleMyTimeout} />
                  )}
                </div>
              </div>

            </div>
          </div>

          <div className="game-sidebar">
            <div className="move-list-container">
              <MoveList moves={moves} />
            </div>

            <div className="game-controls">
              {gameActive ? (
                isPassAndPlay ? (
                  <div className="action-buttons" style={{ flexDirection: 'column', gap: '8px' }}>
                    <div style={{ position: 'relative' }}>
                      <button
                        className="btn-neon interactive"
                        style={{
                          width: '100%',
                          background: 'transparent',
                          color: activeColor === 'white' ? 'var(--royal-crimson, #8B2500)' : 'rgba(139,37,0,0.35)',
                          borderColor: activeColor === 'white' ? 'var(--royal-crimson, #8B2500)' : 'rgba(139,37,0,0.25)',
                          cursor: activeColor === 'white' ? 'pointer' : 'not-allowed',
                        }}
                        disabled={activeColor !== 'white'}
                        onClick={() => setPassPlayResignColor(passPlayResignColor === 'white' ? null : 'white')}
                      >♔ White Resign</button>
                      {passPlayResignColor === 'white' && (
                        <div style={{
                          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
                          background: 'var(--royal-parchment, #1a1208)', border: '1px solid var(--royal-crimson, #8B2500)',
                          borderRadius: '8px', padding: '10px', zIndex: 50, textAlign: 'center',
                          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                        }}>
                          <p style={{ fontSize: '0.8rem', marginBottom: '8px', color: 'var(--royal-ink, #f0e6c8)' }}>White really wants to resign?</p>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button className="btn-neon interactive" style={{ fontSize: '0.75rem', padding: '5px 12px', background: 'var(--royal-crimson)', color: '#fff', borderColor: 'var(--royal-crimson)' }}
                              onClick={() => { setPassPlayResignColor(null); sendResign('white'); useGameStore.getState().setResult('black'); }}
                            >Yes, Resign</button>
                            <button className="btn-neon interactive" style={{ fontSize: '0.75rem', padding: '5px 12px', background: 'transparent' }}
                              onClick={() => setPassPlayResignColor(null)}
                            >Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <button
                        className="btn-neon interactive"
                        style={{
                          width: '100%',
                          background: 'transparent',
                          color: activeColor === 'black' ? 'var(--royal-crimson, #8B2500)' : 'rgba(139,37,0,0.35)',
                          borderColor: activeColor === 'black' ? 'var(--royal-crimson, #8B2500)' : 'rgba(139,37,0,0.25)',
                          cursor: activeColor === 'black' ? 'pointer' : 'not-allowed',
                        }}
                        disabled={activeColor !== 'black'}
                        onClick={() => setPassPlayResignColor(passPlayResignColor === 'black' ? null : 'black')}
                      >♚ Black Resign</button>
                      {passPlayResignColor === 'black' && (
                        <div style={{
                          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
                          background: 'var(--royal-parchment, #1a1208)', border: '1px solid var(--royal-crimson, #8B2500)',
                          borderRadius: '8px', padding: '10px', zIndex: 50, textAlign: 'center',
                          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                        }}>
                          <p style={{ fontSize: '0.8rem', marginBottom: '8px', color: 'var(--royal-ink, #f0e6c8)' }}>Black really wants to resign?</p>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button className="btn-neon interactive" style={{ fontSize: '0.75rem', padding: '5px 12px', background: 'var(--royal-crimson)', color: '#fff', borderColor: 'var(--royal-crimson)' }}
                              onClick={() => { setPassPlayResignColor(null); sendResign('black'); useGameStore.getState().setResult('white'); }}
                            >Yes, Resign</button>
                            <button className="btn-neon interactive" style={{ fontSize: '0.75rem', padding: '5px 12px', background: 'transparent' }}
                              onClick={() => setPassPlayResignColor(null)}
                            >Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="action-buttons">
                    <button
                      className="btn-neon interactive"
                      style={{ background: 'transparent', color: 'var(--royal-crimson, #8B2500)', borderColor: 'var(--royal-crimson, #8B2500)' }}
                      onClick={resignAndClose}
                    >Resign</button>
                    <div style={{ position: 'relative' }}>
                      <button
                        className="btn-neon interactive"
                        style={{ background: 'transparent', color: 'var(--royal-brass, #A67C52)', borderColor: 'var(--royal-brass, #A67C52)', opacity: drawOfferSent ? 0.6 : 1 }}
                        onClick={drawOfferSent ? undefined : sendDrawOffer}
                        disabled={drawOfferSent}
                        title={drawOfferSent ? 'Waiting for opponent to accept…' : 'Offer a draw'}
                      >{drawOfferSent ? '🤝 Waiting…' : 'Offer Draw'}</button>
                      {drawDeclinedMsg && (
                        <div style={{
                          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
                          background: '#1a1208', border: '1px solid var(--royal-crimson)', borderRadius: '6px',
                          padding: '6px 12px', fontSize: '0.75rem', whiteSpace: 'normal', maxWidth: '90vw', textAlign: 'center', zIndex: 50,
                          color: 'var(--royal-crimson)',
                        }}>{drawDeclinedMsg}</div>
                      )}
                    </div>
                  </div>
                )
              ) : (
                <div className="game-over-banner">
                  <h3>Game Over: {result}</h3>
                  <button className="btn-neon interactive" onClick={() => navigate(`/review/${id}`)}>
                    Review Game
                  </button>
                </div>
              )}
            </div>

            {trainingMode && (
              <CoachPanel
                onPlayMove={handleMove}
              />
            )}
          </div>

        </div>
      </motion.div>
    </>
  );
}
