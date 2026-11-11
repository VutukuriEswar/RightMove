import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { broadcastsApi } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import {
  eventStatus,
  formatBroadcastClock,
  formatEventDates,
  formatRoundDate,
  gameResultClass,
  lastMoveSquares,
  parseClockStrToMs,
  parseInitialTimeControlMs,
} from '../lib/broadcastUtils';
import { uciToSquares } from '../lib/chessUtils';
import Board2D from '../components/board/Board2D';
import Clock from '../components/game/Clock';
import MoveList from '../components/game/MoveList';
import EventCard from '../components/events/EventCard';
import GameList from '../components/events/GameList';
import AnalysisPanel from '../components/events/AnalysisPanel';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live Now' },
  { id: 'completed', label: 'Completed' },
  { id: 'upcoming', label: 'Upcoming' },
];

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function playerInitials(name) {
  if (!name) return '?';
  const clean = name.replace(/,/g, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

function dedupe(events) {
  const seen = new Set();
  return events.filter((event) => {
    if (!event?.id || seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

export default function Events() {
  const { tourId } = useParams();
  return tourId ? <EventDetail tourId={tourId} /> : <EventBrowser />;
}

function EventBrowser() {
  const [tab, setTab] = useState('all');
  const [top, setTop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQueries, setSearchQueries] = useState({
    all: '',
    live: '',
    completed: '',
    upcoming: '',
  });

  const loadTop = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await broadcastsApi.top(1);
      setTop(data);
      setError(null);
    } catch (e) {
      if (!silent) setError(e.message || 'Could not load events.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTop();
    const timer = setInterval(() => loadTop({ silent: true }), 60000);
    return () => clearInterval(timer);
  }, [loadTop]);

  const lists = useMemo(() => {
    const liveList = (top?.active || []).filter((e) => e.is_live || e.active_round?.ongoing);
    const upcomingList = dedupe([
      ...(top?.upcoming || []),
      ...(top?.active || []).filter((e) => e.is_upcoming),
    ]);
    const completedList = dedupe([
      ...(top?.past || []),
      ...(top?.active || []).filter((e) => e.is_finished),
    ]);
    const allList = dedupe([
      ...liveList,
      ...upcomingList,
      ...completedList,
      ...(top?.active || []),
      ...(top?.past || []),
    ]);

    return {
      all: allList,
      live: liveList,
      completed: completedList,
      upcoming: upcomingList,
    };
  }, [top]);

  const currentQuery = searchQueries[tab] || '';
  const setTabQuery = (val) => setSearchQueries((prev) => ({ ...prev, [tab]: val }));

  const filteredEvents = useMemo(() => {
    const list = lists[tab] || [];
    const q = currentQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((event) => {
      const text = [
        event.name,
        event.format,
        event.location,
        event.time_control,
        event.group?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [lists, tab, currentQuery]);

  const activeTabMeta = TABS.find((t) => t.id === tab) || TABS[0];

  return (
    <motion.div
      className="events-page page-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      <header className="ev-hero">
        <div className="ev-hero-text">
          <p className="ev-kicker">Free forever · Powered by Lichess</p>
          <h1 className="ev-hero-title">Live Events</h1>
          <p className="ev-hero-sub">
            Watch the world's biggest chess broadcasts as they happen, then replay every finished
            game with free local Stockfish analysis. No subscription, no paywall.
          </p>
        </div>
        <div className="ev-hero-mark" aria-hidden="true">♜</div>
      </header>

      <div className="ev-tabs" role="tablist" aria-label="Event lists">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`ev-tab interactive${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.id === 'live' && <span className="ev-live-dot" />}
            {item.label}
          </button>
        ))}
      </div>

      <div className="ev-section-search-bar">
        <div className="ev-search-input-wrap">
          <span className="ev-search-icon" aria-hidden="true">🔍</span>
          <input
            type="text"
            className="ev-search-input interactive"
            value={currentQuery}
            onChange={(e) => setTabQuery(e.target.value)}
            placeholder={`Search ${activeTabMeta.label} events by name, format, or location…`}
            aria-label={`Search ${activeTabMeta.label} events`}
          />
          {currentQuery && (
            <button
              type="button"
              className="ev-search-clear interactive"
              onClick={() => setTabQuery('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <div className="ev-search-count mono">
          {filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'}
        </div>
      </div>

      <section className="ev-list-section">
        {loading && !top && <p className="ev-empty-note">Loading broadcasts…</p>}
        {error && (
          <div className="alert alert-error">
            {error}{' '}
            <button type="button" className="ev-text-btn interactive" onClick={() => loadTop()}>
              Retry
            </button>
          </div>
        )}
        {!loading && top && filteredEvents.length === 0 && (
          <p className="ev-empty-note">
            {currentQuery
              ? `No events matched "${currentQuery}" in ${activeTabMeta.label}.`
              : tab === 'live'
                ? 'No broadcasts are live right now. Check the Upcoming tab or browse Completed events.'
                : tab === 'upcoming'
                  ? 'No upcoming broadcasts are listed yet.'
                  : tab === 'completed'
                    ? 'No completed broadcasts available.'
                    : 'No broadcasts available.'}
          </p>
        )}
        {filteredEvents.length > 0 && (
          <div className="ev-grid">
            {filteredEvents.map((event, index) => (
              <EventCard key={`${tab}-${event.id}`} event={event} index={index} />
            ))}
          </div>
        )}
      </section>
    </motion.div>
  );
}

function EventDetail({ tourId }) {
  const { isLoggedIn } = useAuth();
  const [event, setEvent] = useState(null);
  const [roundId, setRoundId] = useState(null);
  const [round, setRound] = useState(null);
  const [loading, setLoading] = useState(true);
  const [roundLoading, setRoundLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [boardPly, setBoardPly] = useState(-1);
  const [flipped, setFlipped] = useState(false);
  const [eventProgress, setEventProgress] = useState(null);
  const roundsRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEvent(null);
    setRound(null);
    setRoundId(null);
    setSelectedGameId(null);
    broadcastsApi
      .tournament(tourId)
      .then((data) => {
        if (cancelled) return;
        setEvent(data);
        const rounds = data.rounds || [];
        let preferred = data.default_round_id;
        if (data.is_live && data.active_round?.id) {
          preferred = data.active_round.id;
        } else if (data.is_finished && rounds.length) {
          preferred = rounds[rounds.length - 1].id;
        } else if (!preferred) {
          preferred = data.active_round?.id || rounds[0]?.id || null;
        }
        setRoundId(preferred);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || 'Could not load this event.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tourId]);

  useEffect(() => {
    let alive = true;
    const fetchProgress = async () => {
      try {
        const prog = await broadcastsApi.tournamentProgress(tourId);
        if (alive && prog) {
          setEventProgress(prog);
        }
      } catch (_) {}
    };
    fetchProgress();
    const interval = setInterval(fetchProgress, 12000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [tourId]);

  const loadRound = useCallback(
    async ({ silent = false } = {}) => {
      if (!roundId) return;
      if (!silent) setRoundLoading(true);
      try {
        const data = await broadcastsApi.round(roundId, tourId);
        setRound(data);
        setError(null);
        setSelectedGameId((prev) => {
          const games = data.games || [];
          if (prev && games.some((g) => g.id === prev)) return prev;
          const liveGame = games.find((g) => g.result === '*');
          return liveGame?.id || games[0]?.id || null;
        });
      } catch (e) {
        if (!silent) setError(e.message || 'Could not load this round.');
      } finally {
        if (!silent) setRoundLoading(false);
      }
    },
    [roundId, tourId]
  );

  useEffect(() => {
    setRound(null);
    setSelectedGameId(null);
  }, [roundId]);

  useEffect(() => {
    const container = roundsRef.current;
    if (!container) return;
    const active = container.querySelector('.ev-round-chip.is-active');
    if (!active) return;
    const target = active.offsetLeft - container.clientWidth / 2 + active.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [roundId, event]);

  useEffect(() => {
    if (roundId) loadRound();
  }, [roundId, loadRound]);

  useEffect(() => {
    if (!round) return undefined;
    const stillPlaying =
      round.ongoing || (round.games || []).some((g) => g.result === '*');
    if (!stillPlaying) return undefined;
    const timer = setInterval(() => loadRound({ silent: true }), 15000);
    return () => clearInterval(timer);
  }, [round, loadRound]);

  useEffect(() => {
    setAnalysis(null);
    setBoardPly(-1);
  }, [selectedGameId]);

  const selectedGame = useMemo(() => {
    const games = round?.games || [];
    return games.find((g) => g.id === selectedGameId) || games[0] || null;
  }, [round, selectedGameId]);

  const isLiveGame = selectedGame?.result === '*';

  useEffect(() => {
    if (!tourId || !roundId || !selectedGameId) return;
    broadcastsApi.prioritize(tourId, roundId, selectedGameId, isLiveGame).catch(() => {});
  }, [tourId, roundId, selectedGameId, isLiveGame]);

  const gameMoves = useMemo(() => {
    if (analysis?.moves && analysis.moves.length > 0) return analysis.moves;
    return selectedGame?.moves || [];
  }, [analysis, selectedGame]);

  const safePly = boardPly >= 0 && boardPly < gameMoves.length ? boardPly : -1;
  const currentMove = safePly >= 0 ? gameMoves[safePly] : null;
  const boardFen = currentMove?.fen_after || selectedGame?.fen || START_FEN;
  const lastMove = currentMove
    ? uciToSquares(currentMove.uci)
    : lastMoveSquares(selectedGame?.last_move);

  useEffect(() => {
    if (!gameMoves.length) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') {
        setBoardPly((p) => Math.max(0, (p < 0 ? gameMoves.length - 1 : p) - 1));
      } else if (e.key === 'ArrowRight') {
        setBoardPly((p) => (p < 0 ? 0 : Math.min(gameMoves.length - 1, p + 1)));
      } else if (e.key === 'Home') {
        setBoardPly(0);
      } else if (e.key === 'End' || e.key === 'Escape') {
        setBoardPly(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameMoves.length]);

  const isWhiteWinner = selectedGame?.result === '1-0';
  const isBlackWinner = selectedGame?.result === '0-1';

  const whiteData = useMemo(() => {
    const name = analysis?.headers?.white || selectedGame?.white || 'White';
    const title = analysis?.headers?.white_title || selectedGame?.white_title;
    const rating = analysis?.headers?.white_elo || selectedGame?.white_rating;
    const fed = selectedGame?.white_fed;
    const rawAvatar =
      analysis?.headers?.white_avatar ||
      selectedGame?.white_avatar ||
      (selectedGame?.white_fide_id ? broadcastsApi.playerAvatarUrl(selectedGame.white_fide_id) : null);
    const avatar = broadcastsApi.avatarUrl(rawAvatar);
    const clockMs = selectedGame?.white_clock_ms;
    const res = selectedGame?.result;
    let resultText = '';
    if (res && res !== '*') {
      resultText = res === '1-0' ? '1' : res === '0-1' ? '0' : '½';
    }
    return {
      color: 'white',
      name,
      title,
      rating,
      fed,
      avatar,
      clockMs,
      resultText,
      initials: playerInitials(name),
      isWinner: isWhiteWinner,
    };
  }, [analysis, selectedGame, isWhiteWinner]);

  const blackData = useMemo(() => {
    const name = analysis?.headers?.black || selectedGame?.black || 'Black';
    const title = analysis?.headers?.black_title || selectedGame?.black_title;
    const rating = analysis?.headers?.black_elo || selectedGame?.black_rating;
    const fed = selectedGame?.black_fed;
    const rawAvatar =
      analysis?.headers?.black_avatar ||
      selectedGame?.black_avatar ||
      (selectedGame?.black_fide_id ? broadcastsApi.playerAvatarUrl(selectedGame.black_fide_id) : null);
    const avatar = broadcastsApi.avatarUrl(rawAvatar);
    const clockMs = selectedGame?.black_clock_ms;
    const res = selectedGame?.result;
    let resultText = '';
    if (res && res !== '*') {
      resultText = res === '0-1' ? '1' : res === '1-0' ? '0' : '½';
    }
    return {
      color: 'black',
      name,
      title,
      rating,
      fed,
      avatar,
      clockMs,
      resultText,
      initials: playerInitials(name),
      isWinner: isBlackWinner,
    };
  }, [analysis, selectedGame, isBlackWinner]);

  const activeTurnColor = useMemo(() => {
    if (safePly >= 0 && currentMove) {
      return currentMove.is_white ? 'black' : 'white';
    }
    if (isLiveGame) {
      const fenPart = (boardFen || '').split(' ')[1];
      return fenPart === 'w' ? 'white' : 'black';
    }
    return null;
  }, [safePly, currentMove, isLiveGame, boardFen]);

  const getPlayerClockDisplay = useCallback((playerColor) => {
    const isWhite = playerColor === 'white';
    if (safePly >= 0 && gameMoves.length > 0) {
      for (let i = safePly; i >= 0; i -= 1) {
        const m = gameMoves[i];
        if (m && m.is_white === isWhite && m.clock_str) {
          const ms = parseClockStrToMs(m.clock_str);
          return {
            type: 'static',
            display: formatBroadcastClock(ms) || m.clock_str,
          };
        }
      }
      const initialMs = parseInitialTimeControlMs(event?.time_control);
      if (initialMs) {
        return { type: 'static', display: formatBroadcastClock(initialMs) };
      }
      return { type: 'static', display: '--:--' };
    }

    const liveMs = isWhite ? selectedGame?.white_clock_ms : selectedGame?.black_clock_ms;
    const isTurn = activeTurnColor === playerColor;
    if (liveMs != null) {
      if (isTurn && isLiveGame && safePly < 0) {
        return { type: 'live', ms: liveMs };
      }
      return { type: 'static', display: formatBroadcastClock(liveMs) };
    }

    if (gameMoves.length > 0) {
      for (let i = gameMoves.length - 1; i >= 0; i -= 1) {
        const m = gameMoves[i];
        if (m && m.is_white === isWhite && m.clock_str) {
          const ms = parseClockStrToMs(m.clock_str);
          return {
            type: 'static',
            display: formatBroadcastClock(ms) || m.clock_str,
          };
        }
      }
    }

    const initialMs = parseInitialTimeControlMs(event?.time_control);
    if (initialMs) {
      return { type: 'static', display: formatBroadcastClock(initialMs) };
    }
    return { type: 'static', display: '--:--' };
  }, [safePly, gameMoves, selectedGame, activeTurnColor, isLiveGame, event?.time_control]);

  if (loading) {
    return (
      <div className="events-page page-full">
        <p className="ev-empty-note">Loading event…</p>
      </div>
    );
  }

  if (error && !event) {
    return (
      <div className="events-page page-full">
        <Link to="/events" className="ev-back">← All events</Link>
        <div className="alert alert-error" style={{ marginTop: 16 }}>{error}</div>
      </div>
    );
  }

  if (!event) return null;

  const status = eventStatus(event);
  const meta = [event.format, event.time_control, event.location, formatEventDates(event.dates)]
    .filter(Boolean)
    .join(' · ');

  const topPlayer = flipped ? whiteData : blackData;
  const bottomPlayer = flipped ? blackData : whiteData;
  const isTopTurn = activeTurnColor === topPlayer.color;
  const isBottomTurn = activeTurnColor === bottomPlayer.color;

  const renderPlayerInfo = (player, isTurn, position) => {
    const clockInfo = getPlayerClockDisplay(player.color);

    return (
      <div className={`player-info ${position}${isTurn ? ' active-turn' : ''} ev-player-card${player.isWinner ? ' is-winner-card' : ''}`}>
        <div className="player-info-left">
          <div className="player-avatar ev-avatar">
            {player.avatar ? (
              <img
                src={player.avatar}
                alt={player.name}
                className="ev-avatar-img"
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fb = e.currentTarget.parentElement?.querySelector('.ev-avatar-fallback');
                  if (fb) fb.style.display = 'flex';
                }}
              />
            ) : null}
            <span
              className="ev-avatar-fallback"
              style={{ display: player.avatar ? 'none' : 'flex' }}
            >
              {player.initials}
            </span>
          </div>
          <div className="ev-player-meta-box">
            <div className="ev-player-name-row">
              {player.title && <span className="ev-player-title-pill">{player.title}</span>}
              <span className="player-name">{player.name}</span>
              {player.isWinner && <span className="ev-crown" title="Winner">👑</span>}
              {player.fed && <span className="ev-player-fed-pill">{player.fed}</span>}
            </div>
            <div className="ev-player-sub-row">
              {player.rating && (
                <span className="ev-player-rating-text mono">{player.rating} ELO</span>
              )}
            </div>
          </div>
          {isTurn && (
            <span className="turn-badge ev-turn-badge">
              <span className="turn-dot" />TO MOVE
            </span>
          )}
        </div>
        <div className="player-info-right">
          {player.resultText ? (
            <span className={`ev-board-result-badge mono${player.isWinner ? ' is-winner' : ''}`}>{player.resultText}</span>
          ) : null}
          {clockInfo.type === 'live' ? (
            <Clock ms={clockInfo.ms} active={true} formatFn={formatBroadcastClock} />
          ) : (
            <div className="clock">
              <span className="clock-time mono">{clockInfo.display}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <motion.div
      className="events-page ev-detail page-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Link to="/events" className="ev-back">← All events</Link>

      <header className="ev-detail-head">
        <div className="ev-detail-title-row">
          <div>
            <p className="ev-kicker">
              {status.key === 'live' && <span className="ev-live-dot" />}
              {status.label} · Lichess broadcast
            </p>
            <h1 className="ev-detail-title">{event.name}</h1>
            {meta && <p className="ev-detail-meta">{meta}</p>}
          </div>
          <div className="ev-detail-actions">
            {eventProgress && eventProgress.total_games > 0 && (
              <div className="ev-analysis-progress-badge" title="Automated Stockfish Analysis Pipeline">
                <span className="ev-analysis-spark">⚡</span>
                <span>
                  Analysis: {eventProgress.completed_games}/{eventProgress.total_games} games
                  {eventProgress.status === 'completed' ? ' · Ready' : ' in progress'}
                </span>
              </div>
            )}
            {event.website && (
              <a className="ev-text-btn interactive" href={event.website} target="_blank" rel="noreferrer">
                Event site ↗
              </a>
            )}
            {event.url && (
              <a className="ev-text-btn interactive" href={event.url} target="_blank" rel="noreferrer">
                Lichess ↗
              </a>
            )}
          </div>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      {(event.rounds || []).length > 0 && (
        <div className="ev-rounds-nav-wrap">
          <button
            type="button"
            className="ev-rounds-nav-btn prev interactive"
            aria-label="Scroll rounds left"
            onClick={() => {
              if (roundsRef.current) {
                roundsRef.current.scrollBy({ left: -260, behavior: 'smooth' });
              }
            }}
          >
            ‹
          </button>
          <div className="ev-rounds" role="tablist" aria-label="Rounds" ref={roundsRef}>
            {event.rounds.map((r) => (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={r.id === roundId}
                className={`ev-round-chip interactive${r.id === roundId ? ' is-active' : ''}${r.ongoing ? ' is-live' : ''}`}
                onClick={() => setRoundId(r.id)}
              >
                {r.ongoing && <span className="ev-live-dot" />}
                <span>{r.name}</span>
                {r.starts_at && <span className="ev-round-date">{formatRoundDate(r.starts_at)}</span>}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ev-rounds-nav-btn next interactive"
            aria-label="Scroll rounds right"
            onClick={() => {
              if (roundsRef.current) {
                roundsRef.current.scrollBy({ left: 260, behavior: 'smooth' });
              }
            }}
          >
            ›
          </button>
        </div>
      )}

      <div className="ev-detail-grid">
        <div className="ev-board-column">
          <div className="ev-board-card glass-panel">
            {selectedGame ? (
              <>
                <div className={`ev-outcome-banner ev-outcome-${gameResultClass(selectedGame.result)}`}>
                  {selectedGame.result === '1-0' ? (
                    <span><span className="ev-crown">👑</span> <strong>{selectedGame.white}</strong> won against {selectedGame.black} (1 - 0)</span>
                  ) : selectedGame.result === '0-1' ? (
                    <span><span className="ev-crown">👑</span> <strong>{selectedGame.black}</strong> won against {selectedGame.white} (0 - 1)</span>
                  ) : selectedGame.result === '1/2-1/2' ? (
                    <span>🤝 <strong>Draw</strong> between {selectedGame.white} and {selectedGame.black} (½ - ½)</span>
                  ) : (
                    <span><span className="ev-live-dot" /> <strong>Live Match</strong> · {selectedGame.white} vs {selectedGame.black} in progress</span>
                  )}
                </div>

                {renderPlayerInfo(topPlayer, isTopTurn, 'top')}
                <div className="ev-board-wrap">
                  <Board2D
                    id={`evBoard-${selectedGame.id || 'game'}`}
                    fen={boardFen}
                    disabled={true}
                    lastMove={lastMove}
                    flipped={flipped}
                  />
                </div>
                {renderPlayerInfo(bottomPlayer, isBottomTurn, 'bottom')}

                <div className="ev-board-toolbar">
                  <div className="ev-move-controls">
                    <button
                      type="button"
                      className="ev-nav-btn interactive"
                      onClick={() => setBoardPly(0)}
                      disabled={!gameMoves.length || safePly === 0}
                      title="First move (Home)"
                    >
                      |‹‹
                    </button>
                    <button
                      type="button"
                      className="ev-nav-btn interactive"
                      onClick={() => setBoardPly((p) => Math.max(0, (p < 0 ? gameMoves.length - 1 : p) - 1))}
                      disabled={!gameMoves.length || safePly === 0}
                      title="Previous move (Left arrow)"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      className="ev-nav-btn interactive"
                      onClick={() => setBoardPly((p) => (p < 0 ? 0 : Math.min(gameMoves.length - 1, p + 1)))}
                      disabled={!gameMoves.length || (safePly >= 0 && safePly >= gameMoves.length - 1)}
                      title="Next move (Right arrow)"
                    >
                      ›
                    </button>
                    <button
                      type="button"
                      className="ev-nav-btn interactive"
                      onClick={() => setBoardPly(-1)}
                      disabled={safePly < 0}
                      title="Live / End position (End)"
                    >
                      ››|
                    </button>
                  </div>

                  <button
                    type="button"
                    className="ev-tool-btn interactive"
                    onClick={() => setFlipped((v) => !v)}
                  >
                    Flip board
                  </button>
                  {safePly >= 0 && (
                    <button
                      type="button"
                      className="ev-tool-btn interactive"
                      onClick={() => setBoardPly(-1)}
                    >
                      Back to live
                    </button>
                  )}
                  {roundId && (
                    <a
                      className="ev-tool-btn interactive"
                      href={broadcastsApi.roundPgnUrl(roundId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download PGN
                    </a>
                  )}
                  {event.time_control && (
                    <span className="ev-tc-badge" title="Event Time Control">
                      ⏱ {event.time_control}
                    </span>
                  )}
                </div>

                {currentMove ? (
                  <p className="ev-move-pill">
                    Move {Math.floor(safePly / 2) + 1}
                    {safePly % 2 === 0 ? '.' : '…'} {currentMove.san}
                    {currentMove.classification && (
                      <span className={`badge badge-${currentMove.classification}`} style={{ marginLeft: 8 }}>
                        {currentMove.classification}
                      </span>
                    )}
                  </p>
                ) : selectedGame?.last_move ? (
                  <p className="ev-move-pill">
                    Last move: {selectedGame.last_move}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="ev-empty-note">
                {roundLoading ? 'Loading round…' : 'No games are available in this round yet.'}
              </p>
            )}
          </div>

          {gameMoves.length > 0 && (
            <section className="ev-moves glass-panel">
              <div className="ev-moves-head">
                <div>
                  <p className="ev-kicker">{analysis ? 'Stockfish analyzed' : 'Game moves'}</p>
                  <h3 className="ev-section-title">Moves ({gameMoves.length} plies)</h3>
                </div>
                <button
                  type="button"
                  className="ev-text-btn interactive"
                  onClick={() => setBoardPly(-1)}
                  disabled={safePly < 0}
                >
                  Live position
                </button>
              </div>
              <div className="ev-moves-list">
                <MoveList
                  moves={gameMoves}
                  activeIndex={safePly}
                  onMoveClick={(idx) => setBoardPly(idx)}
                />
              </div>
              <p className="ev-hint">Use arrow keys or buttons to step through moves · Esc returns to live position</p>
            </section>
          )}
        </div>

        <div className="ev-side-column">
          <section className="ev-games glass-panel">
            <div className="ev-games-head">
              <div>
                <p className="ev-kicker">{round?.name || 'Round'}</p>
                <h3 className="ev-section-title">Games</h3>
              </div>
              {round?.ongoing && (
                <span className="ev-live-pill">
                  <span className="ev-live-dot" /> Live
                </span>
              )}
            </div>
            {roundLoading && !round ? (
              <p className="ev-empty-note">Loading games…</p>
            ) : (
              <GameList
                games={round?.games || []}
                selectedId={selectedGameId}
                onSelect={(g) => setSelectedGameId(g.id)}
              />
            )}
          </section>

          {selectedGame && roundId && (
            <AnalysisPanel
              roundId={roundId}
              gameId={selectedGame.id}
              tourId={event.id}
              game={selectedGame}
              isLoggedIn={isLoggedIn}
              onAnalysisLoaded={setAnalysis}
              currentPly={safePly}
              onSelectPly={setBoardPly}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}
