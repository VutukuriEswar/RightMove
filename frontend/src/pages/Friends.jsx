import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { friendsApi, gamesApi } from '../lib/api';
import FriendCard from '../components/friends/FriendCard';

function tcLabel(tc, inc) {
  if (!tc || tc === 0) return 'No timer';
  if (tc < 60) return `${tc}s`;
  const m = Math.round(tc / 60);
  return inc ? `${m}+${inc}` : `${m} min`;
}

export default function Friends() {
  const navigate = useNavigate();
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [sent, setSent] = useState([]);
  const [challengesIn, setChallengesIn] = useState([]);
  const [challengesOut, setChallengesOut] = useState([]);
  const [records, setRecords] = useState({});
  const [pausedByFriend, setPausedByFriend] = useState({});
  const [newFriendName, setNewFriendName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busyUser, setBusyUser] = useState(null);
  const [busyChallenge, setBusyChallenge] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const sentChallengeIds = useRef(new Set());

  const loadPausedMatches = useCallback(() => {
    friendsApi
      .pausedMatches()
      .then((data) => {
        const grouped = {};
        (data.paused_games || []).forEach((g) => {
          if (!g.friend_username) return;
          if (!grouped[g.friend_username]) grouped[g.friend_username] = [];
          grouped[g.friend_username].push(g);
        });
        setPausedByFriend(grouped);
      })
      .catch(() => {});
  }, []);

  const loadInbox = useCallback(() => {
    friendsApi
      .incomingChallenges()
      .then((d) => setChallengesIn(d.challenges || []))
      .catch(() => {});
    friendsApi
      .outgoingChallenges()
      .then((d) => setChallengesOut(d.challenges || []))
      .catch(() => {});
    loadPausedMatches();
  }, [loadPausedMatches]);

  const loadFriends = useCallback(() => {
    friendsApi
      .list()
      .then((data) => {
        const list = data.friends || [];
        setFriends(list);
        setRequests(data.pending_requests || []);
        setSent(data.sent_requests || []);
        list.forEach((f) => {
          friendsApi
            .record(f.username)
            .then((r) => setRecords((prev) => ({ ...prev, [f.username]: r })))
            .catch(() => {});
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadInbox();
    }, 4000);
    return () => clearInterval(timer);
  }, [loadInbox]);

  useEffect(() => {
    const hit = challengesOut.find(
      (c) => c.status === 'accepted' && c.game_id && sentChallengeIds.current.has(c.id)
    );
    if (hit) {
      sentChallengeIds.current.delete(hit.id);
      navigate(`/game/${hit.game_id}`);
    }
  }, [challengesOut, navigate]);

  const handleSendRequest = async (e) => {
    e.preventDefault();
    if (!newFriendName.trim()) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await friendsApi.sendRequest(newFriendName.trim());
      if (res?.status === 'accepted') {
        setSuccess(`You and ${newFriendName} are now friends — you had both requested each other!`);
      } else {
        setSuccess(`Friend request sent to ${newFriendName}!`);
      }
      setNewFriendName('');
      loadFriends();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAccept = async (username) => {
    try {
      await friendsApi.accept(username);
      loadFriends();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDecline = async (username) => {
    try {
      await friendsApi.decline(username);
      loadFriends();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCancelSent = async (username) => {
    try {
      await friendsApi.cancelRequest(username);
      loadFriends();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleChallenge = async (username, tc, inc = 0, color = 'random', isCancel = false) => {
    setError(null);
    setSuccess(null);
    if (isCancel) {
      const out = challengesOut.find((c) => c.to_username === username);
      if (!out) return;
      setBusyUser(username);
      try {
        await friendsApi.cancelChallenge(out.id);
        loadInbox();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusyUser(null);
      }
      return;
    }
    setBusyUser(username);
    try {
      const res = await friendsApi.challenge(username, tc, inc, color);
      if (res?.challenge_id) sentChallengeIds.current.add(res.challenge_id);
      const colorStr = color === 'random' ? 'Random color' : `${color.charAt(0).toUpperCase() + color.slice(1)}`;
      setSuccess(`Challenge sent to ${username} (${tcLabel(tc, inc)} · ${colorStr})!`);
      loadInbox();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyUser(null);
    }
  };

  const handleChallengePgn = async (username, pgnText, tc = 0, inc = 0, color = 'random') => {
    setError(null);
    setSuccess(null);
    setBusyUser(username);
    try {
      const res = await friendsApi.challenge(username, tc, inc, color, pgnText);
      if (res?.challenge_id) sentChallengeIds.current.add(res.challenge_id);
      const movesStr = res?.moves_count ? ` (${res.moves_count} moves)` : '';
      setSuccess(`Resume challenge sent to ${username}${movesStr}! Waiting for them to accept.`);
      loadInbox();
    } catch (err) {
      setError(err.message || 'Failed to send PGN challenge');
    } finally {
      setBusyUser(null);
    }
  };

  const handleAcceptChallenge = async (c) => {
    setBusyChallenge(c.id);
    setError(null);
    try {
      const res = await friendsApi.acceptChallenge(c.id);
      navigate(`/game/${res.game_id}`);
    } catch (err) {
      setError(err.message);
      setBusyChallenge(null);
    }
  };

  const handleDeclineChallenge = async (c) => {
    setBusyChallenge(c.id);
    try {
      await friendsApi.declineChallenge(c.id);
      loadInbox();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyChallenge(null);
    }
  };

  const handleRemove = async (username) => {
    setError(null);
    setSuccess(null);
    setBusyUser(username);
    try {
      await friendsApi.remove(username);
      setRecords((prev) => {
        const next = { ...prev };
        delete next[username];
        return next;
      });
      setFriends((prev) => prev.filter((f) => f.username !== username));
      setSuccess(`${username} removed from friends.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyUser(null);
    }
  };

  const handleResumeGame = async (gameId) => {
    setError(null);
    try {
      await gamesApi.resumeGame(gameId);
      navigate(`/game/${gameId}`);
    } catch (err) {
      setError(err.message || 'Failed to resume game');
    }
  };

  const handleResignPausedGame = async (gameId) => {
    setError(null);
    try {
      await gamesApi.resignPaused(gameId);
      loadPausedMatches();
      loadFriends();
    } catch (err) {
      setError(err.message || 'Failed to resign paused game');
    }
  };

  const outByUser = useMemo(() => {
    const map = {};
    challengesOut.forEach((c) => {
      if (c.status === 'pending') {
        map[c.to_username] = c;
      }
    });
    return map;
  }, [challengesOut]);

  const sorted = useMemo(() => {
    return [...friends].sort((a, b) => {
      const on = (b.is_online ? 1 : 0) - (a.is_online ? 1 : 0);
      if (on !== 0) return on;
      return (records[b.username]?.matches ?? -1) - (records[a.username]?.matches ?? -1);
    });
  }, [friends, records]);

  const topRival = useMemo(() => {
    if (sorted.length === 0) return null;
    const top = sorted.reduce((best, f) => {
      const bestMatches = records[best]?.matches ?? 0;
      const curMatches = records[f.username]?.matches ?? 0;
      return curMatches > bestMatches ? f.username : best;
    }, sorted[0].username);
    return (records[top]?.matches ?? 0) > 0 ? top : null;
  }, [sorted, records]);

  const stats = useMemo(() => {
    let totalBattles = 0;
    let totalWins = 0;
    let onlineCount = 0;
    let rivalsCount = 0;

    friends.forEach((f) => {
      if (f.is_online) onlineCount++;
      const rec = records[f.username];
      if (rec && rec.matches > 0) {
        rivalsCount++;
        totalBattles += rec.matches;
        totalWins += rec.wins;
      }
    });

    const overallWinRate = totalBattles > 0 ? Math.round((totalWins / totalBattles) * 100) : 0;

    return {
      friendsCount: friends.length,
      onlineCount,
      rivalsCount,
      totalBattles,
      overallWinRate,
    };
  }, [friends, records]);

  const filteredFriends = useMemo(() => {
    return sorted.filter((f) => {
      const matchesSearch = f.username.toLowerCase().includes(searchQuery.toLowerCase().trim());
      if (!matchesSearch) return false;

      if (activeTab === 'online') return !!f.is_online;
      return true;
    });
  }, [sorted, searchQuery, activeTab]);

  if (loading) {
    return (
      <div className="page friends-page-loading">
        <div className="spinner-large" />
      </div>
    );
  }

  return (
    <div className="friends-page page">
      <div className="friends-header">
        <div className="friends-header-badge">
          <span>Guild of Champions</span>
        </div>
        <h1>Friends & Rivals</h1>
        <p>Challenge friends online, track long-standing rivalries, and forge your legacy.</p>

        <div className="friends-stats-bar">
          <div className="stat-card">
            <span className="stat-num">{stats.friendsCount}</span>
            <span className="stat-label">Friends</span>
          </div>
          <div className="stat-card">
            <span className="stat-num online-text">🟢 {stats.onlineCount}</span>
            <span className="stat-label">Online Now</span>
          </div>
          <div className="stat-card">
            <span className="stat-num">{stats.totalBattles}</span>
            <span className="stat-label">Battles Played</span>
          </div>
          <div className="stat-card">
            <span className="stat-num gold-text">{stats.overallWinRate}%</span>
            <span className="stat-label">Win Rate</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button type="button" className="alert-close-btn" onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {success && (
        <div className="alert alert-success">
          <span>{success}</span>
          <button type="button" className="alert-close-btn" onClick={() => setSuccess(null)}>✕</button>
        </div>
      )}

      {challengesIn.length > 0 && (
        <div className="incoming-challenges-banner">
          <div className="banner-left">
            <span className="banner-icon">⚔️</span>
            <div className="banner-text">
              <strong>{challengesIn[0].is_imported_pgn ? '📥 Resume Game Challenge Received!' : 'Match Challenge Received!'}</strong>
              <span>
                {challengesIn[0].from_username} has challenged you {challengesIn[0].is_imported_pgn ? `to resume an imported game (${challengesIn[0].moves_count || 0} moves · ${tcLabel(challengesIn[0].time_control_seconds, challengesIn[0].increment_seconds)})` : `(${tcLabel(challengesIn[0].time_control_seconds, challengesIn[0].increment_seconds)})`}
              </span>
            </div>
          </div>
          <div className="banner-actions">
            <button
              className="btn btn-primary btn-sm interactive"
              disabled={busyChallenge === challengesIn[0].id}
              onClick={() => handleAcceptChallenge(challengesIn[0])}
            >
              {challengesIn[0].is_imported_pgn ? 'Accept & Resume' : 'Accept & Play'}
            </button>
            <button
              className="btn btn-secondary btn-sm interactive"
              disabled={busyChallenge === challengesIn[0].id}
              onClick={() => handleDeclineChallenge(challengesIn[0])}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      <div className="friends-content">
        <div className="friends-main-section">
          <div className="friends-toolbar">
            <div className="friends-tabs">
              <button
                type="button"
                className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
                onClick={() => setActiveTab('all')}
              >
                All Friends ({stats.friendsCount})
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === 'online' ? 'active' : ''}`}
                onClick={() => setActiveTab('online')}
              >
                Online ({stats.onlineCount})
              </button>
            </div>

            <div className="friends-search-wrap">
              <input
                type="text"
                placeholder="Search friends..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="friends-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="friends-grid">
            {filteredFriends.map((f) => (
              <div key={f.username} className="friend-card-wrapper">
                <FriendCard
                  friend={f}
                  isOnline={!!f.is_online}
                  record={records[f.username]}
                  spotlight={topRival === f.username}
                  busy={busyUser === f.username}
                  waiting={!!outByUser[f.username]}
                  onChallenge={handleChallenge}
                  onChallengePgn={handleChallengePgn}
                  onRemove={handleRemove}
                  pausedMatches={pausedByFriend[f.username] || []}
                  onResumeGame={handleResumeGame}
                  onResignPaused={handleResignPausedGame}
                />
              </div>
            ))}

            {filteredFriends.length === 0 && (
              <div className="friends-empty-card">
                {friends.length === 0 ? (
                  <>
                    <div className="empty-heraldry">🛡️ ⚔️ 🛡️</div>
                    <h3>No Rivals in Your Hall Yet</h3>
                    <p>Enter a username in the invitation box to challenge your friends, or send an invitation to begin building your rivalry history.</p>
                  </>
                ) : (
                  <>
                    <div className="empty-heraldry">🔍</div>
                    <h3>No Friends Found</h3>
                    <p>No companions match your current search or filter criteria.</p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setSearchQuery('');
                        setActiveTab('all');
                      }}
                    >
                      Clear Filters
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="friends-sidebar">
          {(challengesIn.length > 0 || challengesOut.length > 0) && (
            <div className="card pending-requests-card challenges-sidebar-card">
              <div className="sidebar-card-header">
                <span className="sidebar-card-icon">⚔️</span>
                <h3>Match Challenges</h3>
              </div>
              <div className="request-list">
                {challengesIn.map((c) => (
                  <div key={c.id} className="request-item challenge-item">
                    <div className="request-info">
                      <span className="request-name">{c.from_username}</span>
                      <span className="challenge-tc-meta">
                        {c.is_imported_pgn ? `📥 Resume (${c.moves_count || 0} moves)` : tcLabel(c.time_control_seconds, c.increment_seconds)}
                      </span>
                    </div>
                    <div className="challenge-btns">
                      <button
                        className="btn btn-primary btn-sm interactive"
                        disabled={busyChallenge === c.id}
                        onClick={() => handleAcceptChallenge(c)}
                      >
                        {c.is_imported_pgn ? 'Resume' : 'Play'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm interactive"
                        disabled={busyChallenge === c.id}
                        onClick={() => handleDeclineChallenge(c)}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
                {challengesOut.filter((c) => c.status !== 'accepted').map((c) => (
                  <div key={c.id} className="request-item challenge-item">
                    <div className="request-info">
                      <span className="request-name">⏳ {c.to_username}</span>
                      <span className="challenge-tc-meta">
                        {c.is_imported_pgn ? `📥 Resume (${c.moves_count || 0} moves)` : tcLabel(c.time_control_seconds, c.increment_seconds)}
                      </span>
                    </div>
                    <button
                      className="btn btn-secondary btn-sm interactive"
                      onClick={() => handleChallenge(c.to_username, 0, 0, 'random', true)}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
                {challengesOut.filter((c) => c.status === 'accepted' && c.game_id).map((c) => (
                  <div key={c.id} className="request-item challenge-item">
                    <div className="request-info">
                      <span className="request-name">✓ {c.to_username} accepted</span>
                      <span className="challenge-tc-meta">
                        {tcLabel(c.time_control_seconds, c.increment_seconds)}
                      </span>
                    </div>
                    <Link
                      className="btn btn-secondary btn-sm interactive"
                      to={`/game/${c.game_id}`}
                    >
                      View
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card add-friend-card">
            <div className="sidebar-card-header">
              <span className="sidebar-card-icon">✉️</span>
              <h3>Add Friend</h3>
            </div>
            <p className="add-friend-hint">
              Enter their exact RightMove username to dispatch an invitation.
            </p>
            <form onSubmit={handleSendRequest}>
              <div className="form-group add-friend-form-group">
                <input
                  type="text"
                  placeholder="Username (e.g. Magnus)"
                  value={newFriendName}
                  onChange={(e) => setNewFriendName(e.target.value)}
                  className="add-friend-input"
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary add-friend-btn interactive"
                style={{ width: '100%' }}
              >
                Send Request
              </button>
            </form>
          </div>

          {requests.length > 0 && (
            <div className="card pending-requests-card">
              <div className="sidebar-card-header">
                <span className="sidebar-card-icon">📬</span>
                <h3>Pending Requests ({requests.length})</h3>
              </div>
              <div className="request-list">
                {requests.map((r) => (
                  <div key={r.from_user} className="request-item">
                    <span className="request-name">{r.from_user}</span>
                    <span className="challenge-btns">
                      <button
                        className="btn btn-primary btn-sm interactive"
                        onClick={() => handleAccept(r.from_user)}
                      >
                        Accept
                      </button>
                      <button
                        className="btn btn-secondary btn-sm interactive"
                        onClick={() => handleDecline(r.from_user)}
                      >
                        Decline
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sent.length > 0 && (
            <div className="card pending-requests-card">
              <div className="sidebar-card-header">
                <span className="sidebar-card-icon">📤</span>
                <h3>Sent Requests ({sent.length})</h3>
              </div>
              <div className="request-list">
                {sent.map((r) => (
                  <div key={r.username} className="request-item">
                    <span className="request-name">{r.username}</span>
                    <button
                      className="btn btn-secondary btn-sm interactive"
                      onClick={() => handleCancelSent(r.username)}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

