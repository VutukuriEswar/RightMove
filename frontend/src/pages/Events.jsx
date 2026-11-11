import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { broadcastsApi } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import {
  eventStatus,
  formatBroadcastClock,
  formatEventDates,
  formatRoundDate,
  formatSafeClock,
  gameResultClass,
  lastMoveSquares,
  parseInitialTimeControlMs,
} from '../lib/broadcastUtils';
import { uciToSquares } from '../lib/chessUtils';
import Board2D from '../components/board/Board2D';
import Clock from '../components/game/Clock';
import MoveList from '../components/game/MoveList';
import EventCard from '../components/events/EventCard';
import MatchShelf from '../components/events/MatchShelf';
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

function parseLichessBroadcastUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();
  let after = null;
  const lichessIdx = clean.indexOf('lichess.org/broadcast/');
  if (lichessIdx !== -1) {
    after = clean.slice(lichessIdx + 'lichess.org/broadcast/'.length);
  } else {
    const eventsIdx = clean.indexOf('/events/');
    if (eventsIdx !== -1 && (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('/'))) {
      after = clean.slice(eventsIdx + '/events/'.length);
    }
  }
  if (!after) return null;
  const pathOnly = after.split(/[?#]/)[0];
  const parts = pathOnly.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const tourSlug = parts[0];
  let roundSlug = null;
  let gameSlug = null;
  if (parts.length === 2) {
    roundSlug = parts[1];
  } else if (parts.length === 3) {
    roundSlug = parts[2] || parts[1];
  } else if (parts.length >= 4) {
    roundSlug = parts[2] || parts[1];
    gameSlug = parts[3];
  }
  return {
    raw: clean,
    tourSlug,
    roundSlug,
    gameSlug,
    displayTitle: tourSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  };
}

class EventErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('EventErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="events-page page-full" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div className="alert alert-error" style={{ maxWidth: 620, margin: '0 auto' }}>
            <h3 style={{ margin: '0 0 8px 0', fontFamily: 'Playfair Display, serif', fontSize: '1.25rem' }}>Unable to load match view</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.88rem', color: '#D4AF37' }}>
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
              >
                Reload Match
              </button>
              <a href="/events" className="btn btn-secondary">
                Return to Events
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Events() {
  const { tourId, roundSlug, gameSlug } = useParams();
  return (
    <EventErrorBoundary>
      {tourId ? (
        <EventDetail tourId={tourId} roundSlug={roundSlug} gameSlug={gameSlug} />
      ) : (
        <EventBrowser />
      )}
    </EventErrorBoundary>
  );
}

function EventBrowser() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [top, setTop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState([]);
  const [searchingRemote, setSearchingRemote] = useState(false);

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

  const parsedDirectUrl = useMemo(
    () => parseLichessBroadcastUrl(searchQuery),
    [searchQuery]
  );

  useEffect(() => {
    const q = searchQuery.trim();
    if (parsedDirectUrl || q.length < 2) {
      setRemoteResults([]);
      setSearchingRemote(false);
      return undefined;
    }
    let active = true;
    setSearchingRemote(true);
    const timer = setTimeout(async () => {
      try {
        const res = await broadcastsApi.search(q);
        if (active) {
          setRemoteResults(res?.events || []);
        }
      } catch {
        if (active) setRemoteResults([]);
      } finally {
        if (active) setSearchingRemote(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, parsedDirectUrl]);

  const handleOpenDirect = useCallback(() => {
    if (!parsedDirectUrl) return;
    let target = `/events/${parsedDirectUrl.tourSlug}`;
    if (parsedDirectUrl.roundSlug) {
      target += `/${parsedDirectUrl.roundSlug}`;
      if (parsedDirectUrl.gameSlug) {
        target += `/${parsedDirectUrl.gameSlug}`;
      }
    }
    navigate(target);
  }, [parsedDirectUrl, navigate]);

  const allSearchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    if (parsedDirectUrl) return [];
    const localMatches = (lists.all || []).filter((event) => {
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
    return dedupe([...remoteResults, ...localMatches]);
  }, [searchQuery, parsedDirectUrl, remoteResults, lists.all]);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return lists[tab] || [];
    }
    if (parsedDirectUrl) {
      return [];
    }
    if (tab === 'live') {
      return allSearchResults.filter((e) => e.is_live || e.active_round?.ongoing);
    }
    if (tab === 'completed') {
      return allSearchResults.filter((e) => e.is_finished);
    }
    if (tab === 'upcoming') {
      return allSearchResults.filter((e) => e.is_upcoming);
    }
    return allSearchResults;
  }, [lists, tab, searchQuery, parsedDirectUrl, allSearchResults]);

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
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && parsedDirectUrl) {
                e.preventDefault();
                handleOpenDirect();
              }
            }}
            placeholder={
              parsedDirectUrl
                ? 'Press Enter to open direct broadcast link…'
                : 'Search all Lichess broadcasts by name, year (e.g. 2024), player, or paste URL…'
            }
            aria-label="Search all Lichess broadcasts"
          />
          {searchQuery && (
            <button
              type="button"
              className="ev-search-clear interactive"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <div className="ev-search-count mono">
          {searchingRemote ? (
            <span>Searching Lichess…</span>
          ) : searchQuery.trim() ? (
            <span>{filteredEvents.length} on Lichess</span>
          ) : (
            <span>
              {filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'}
            </span>
          )}
        </div>
      </div>

      {parsedDirectUrl && (
        <div
          className="ev-direct-url-card interactive"
          onClick={handleOpenDirect}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleOpenDirect();
          }}
        >
          <div className="ev-direct-url-info">
            <span className="ev-direct-url-badge">⚡ DIRECT LICHESS BROADCAST DETECTED</span>
            <h3 className="ev-direct-url-title">{parsedDirectUrl.displayTitle}</h3>
            <p className="ev-direct-url-meta">
              {parsedDirectUrl.roundSlug ? `Round: ${parsedDirectUrl.roundSlug} · ` : ''}
              {parsedDirectUrl.gameSlug ? `Game: ${parsedDirectUrl.gameSlug} · ` : ''}
              Click or press Enter to open match in RightMove →
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenDirect();
            }}
          >
            Open Match →
          </button>
        </div>
      )}

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
          <div className="ev-empty-search-box">
            <p className="ev-empty-note">
              {searchQuery.trim()
                ? `No ${activeTabMeta.label.toLowerCase()} broadcasts matched "${searchQuery}".`
                : tab === 'live'
                  ? 'No broadcasts are live right now. Check the Upcoming tab or browse Completed events.'
                  : tab === 'upcoming'
                    ? 'No upcoming broadcasts are listed yet.'
                    : tab === 'completed'
                      ? 'No completed broadcasts available.'
                      : 'No broadcasts available.'}
            </p>
            {searchQuery.trim() && tab !== 'all' && allSearchResults.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: 12 }}
                onClick={() => setTab('all')}
              >
                View all {allSearchResults.length} Lichess search results →
              </button>
            )}
          </div>
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

function EventDetail({ tourId, roundSlug, gameSlug }) {
  const navigate = useNavigate();
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
        let preferred = null;
        if (roundSlug) {
          if (/^\d+$/.test(roundSlug)) {
            const rNum = parseInt(roundSlug, 10);
            if (rNum >= 1 && rNum <= rounds.length) {
              preferred = rounds[rNum - 1].id;
            }
          }
          if (!preferred) {
            const match = rounds.find(
              (r) =>
                r.id === roundSlug ||
                r.slug === roundSlug ||
                r.name?.toLowerCase().replace(/\s+/g, '-') === roundSlug.toLowerCase()
            );
            if (match) preferred = match.id;
          }
        }
        if (!preferred) {
          if (data.is_live && data.active_round?.id) {
            preferred = data.active_round.id;
          } else if (data.is_finished && rounds.length) {
            preferred = rounds[rounds.length - 1].id;
          } else if (!preferred) {
            preferred = data.default_round_id || data.active_round?.id || rounds[0]?.id || null;
          }
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
  }, [tourId, roundSlug]);

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
          if (gameSlug) {
            if (/^\d+$/.test(gameSlug)) {
              const gNum = parseInt(gameSlug, 10);
              if (gNum >= 1 && gNum <= games.length) {
                return games[gNum - 1].id;
              }
            }
            const match = games.find((g) => g.id === gameSlug);
            if (match) return match.id;
          }
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
    [roundId, tourId, gameSlug]
  );

  const handleSelectRound = useCallback(
    (rId) => {
      setRoundId(rId);
      const rIdx = (event?.rounds || []).findIndex((r) => r.id === rId);
      const rSlug = rIdx >= 0 ? `${rIdx + 1}` : rId;
      navigate(`/events/${tourId}/${rSlug}`, { replace: true });
    },
    [event, tourId, navigate]
  );

  const handleSelectGame = useCallback(
    (g) => {
      const targetId = typeof g === 'object' ? g?.id : g;
      if (!targetId) return;
      setSelectedGameId(targetId);
      const rIdx = (event?.rounds || []).findIndex((r) => r.id === roundId);
      const rSlug = rIdx >= 0 ? `${rIdx + 1}` : (roundId || '1');
      const gIdx = (round?.games || []).findIndex((gm) => gm.id === targetId);
      const gSlug = gIdx >= 0 ? `${gIdx + 1}` : targetId;
      navigate(`/events/${tourId}/${rSlug}/${gSlug}`, { replace: true });
    },
    [event, roundId, round, tourId, navigate]
  );

  useEffect(() => {
    if (!event || !roundId || !selectedGameId) return;
    if (!roundSlug || !gameSlug) {
      const rIdx = (event.rounds || []).findIndex((r) => r.id === roundId);
      const rSlug = rIdx >= 0 ? `${rIdx + 1}` : roundId;
      const gIdx = (round?.games || []).findIndex((gm) => gm.id === selectedGameId);
      const gSlug = gIdx >= 0 ? `${gIdx + 1}` : selectedGameId;
      navigate(`/events/${tourId}/${rSlug}/${gSlug}`, { replace: true });
    }
  }, [event, roundId, selectedGameId, round, roundSlug, gameSlug, tourId, navigate]);

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
  }, [tourId, roundId, selectedGameId, isLiveGame, selectedGame?.moves?.length]);

  const gameMoves = useMemo(() => {
    const rawMoves = selectedGame?.moves || [];
    const analyzed = analysis?.moves || [];
    if (!analyzed.length) return rawMoves;
    if (!rawMoves.length) return analyzed;
    if (analyzed.length >= rawMoves.length) return analyzed;
    return rawMoves.map((m, idx) => {
      const a = analyzed[idx];
      return a ? { ...m, ...a } : m;
    });
  }, [analysis, selectedGame]);

  const safePly = boardPly >= 0 && boardPly < gameMoves.length ? boardPly : -1;
  const currentMove = safePly >= 0 ? gameMoves[safePly] : null;
  const activeMove = safePly >= 0
    ? gameMoves[safePly]
    : (gameMoves.length > 0 ? gameMoves[gameMoves.length - 1] : null);
  const boardFen = activeMove?.fen_after || selectedGame?.fen || START_FEN;
  const lastMove = activeMove
    ? uciToSquares(activeMove.uci)
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
    const initialMs = parseInitialTimeControlMs(event?.time_control);

    if (safePly >= 0 && gameMoves.length > 0) {
      for (let i = safePly; i >= 0; i -= 1) {
        const m = gameMoves[i];
        if (m && m.is_white === isWhite && m.clock_str) {
          return {
            type: 'static',
            display: formatSafeClock(m.clock_str, initialMs),
          };
        }
      }
      return {
        type: 'static',
        display: formatSafeClock(null, initialMs),
      };
    }

    const liveMs = isWhite ? selectedGame?.white_clock_ms : selectedGame?.black_clock_ms;
    const isTurn = activeTurnColor === playerColor;
    if (liveMs != null) {
      if (isTurn && isLiveGame && safePly < 0) {
        return { type: 'live', ms: liveMs };
      }
      return { type: 'static', display: formatSafeClock(null, liveMs) };
    }

    if (gameMoves.length > 0) {
      for (let i = gameMoves.length - 1; i >= 0; i -= 1) {
        const m = gameMoves[i];
        if (m && m.is_white === isWhite && m.clock_str) {
          return {
            type: 'static',
            display: formatSafeClock(m.clock_str, initialMs),
          };
        }
      }
    }

    return {
      type: 'static',
      display: formatSafeClock(null, initialMs),
    };
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
      <div className="ev-detail-nav-row">
        <Link to="/events" className="ev-back-btn interactive">
          ← All events
        </Link>
        <div className="ev-detail-nav-actions">
          {event.website && (
            <a className="ev-text-btn interactive" href={event.website} target="_blank" rel="noreferrer">
              Event site ↗
            </a>
          )}
          {event.url && (
            <a className="ev-text-btn interactive" href={event.url} target="_blank" rel="noreferrer">
              ↗ Lichess
            </a>
          )}
        </div>
      </div>

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
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="ev-arena-grid">
        <div className="ev-arena-moves-col">
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
        </div>

        <div className="ev-arena-board-col">
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
        </div>

        <div className="ev-arena-analysis-col">
          {selectedGame && roundId ? (
            <AnalysisPanel
              roundId={roundId}
              gameId={selectedGame.id}
              tourId={event.id}
              game={selectedGame}
              isLoggedIn={isLoggedIn}
              onAnalysisLoaded={setAnalysis}
              currentPly={safePly}
              onSelectPly={setBoardPly}
              boardFen={boardFen}
              currentMove={activeMove}
              whiteData={whiteData}
              blackData={blackData}
            />
          ) : (
            <div className="ev-analysis-placeholder glass-panel">
              <p className="ev-empty-note">Select a match to view Stockfish engine analysis</p>
            </div>
          )}
        </div>
      </div>

      <div className="ev-bottom-shelves">
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
                  onClick={() => handleSelectRound(r.id)}
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

        <MatchShelf
          games={round?.games || []}
          selectedId={selectedGameId}
          onSelect={handleSelectGame}
          roundName={round?.name || 'Round'}
        />
      </div>
    </motion.div>
  );
}
