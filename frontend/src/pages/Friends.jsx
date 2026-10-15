import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { friendsApi } from '../lib/api';
import FriendCard from '../components/friends/FriendCard';

function tcLabel(tc, inc) {
  if (!tc) return 'No timer';
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
  const [newFriendName, setNewFriendName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busyUser, setBusyUser] = useState(null);
  const [busyChallenge, setBusyChallenge] = useState(null);

  const loadInbox = useCallback(() => {
    friendsApi.incomingChallenges().then(d => setChallengesIn(d.challenges || [])).catch(() => {});
    friendsApi.outgoingChallenges().then(d => setChallengesOut(d.challenges || [])).catch(() => {});
  }, []);

  const loadFriends = useCallback(() => {
    friendsApi.list()
      .then(data => {
        const list = data.friends || [];
        setFriends(list);
        setRequests(data.pending_requests || []);
        setSent(data.sent_requests || []);
        list.forEach(f => {
          friendsApi.record(f.username)
            .then(r => setRecords(prev => ({ ...prev, [f.username]: r })))
            .catch(() => {});
        });
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
    loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

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

  const handleChallenge = async (username, tc, isCancel) => {
    setError(null);
    setSuccess(null);
    if (isCancel) {
      const out = challengesOut.find(c => c.to_username === username);
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
      await friendsApi.challenge(username, tc, 0);
      setSuccess(`Challenge sent to ${username} (${tcLabel(tc, 0)})!`);
      loadInbox();
    } catch (err) {
      setError(err.message);
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
      setRecords(prev => {
        const next = { ...prev };
        delete next[username];
        return next;
      });
      setFriends(prev => prev.filter(f => f.username !== username));
      setSuccess(`${username} removed from friends.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyUser(null);
    }
  };

  if (loading) return <div className="page"><div className="spinner-large" /></div>;

  const outByUser = {};
  challengesOut.forEach(c => { outByUser[c.to_username] = c; });
  const sorted = [...friends].sort((a, b) => {
    const on = (b.is_online ? 1 : 0) - (a.is_online ? 1 : 0);
    if (on !== 0) return on;
    return (records[b.username]?.matches ?? -1) - (records[a.username]?.matches ?? -1);
  });
  const topRival = sorted.length > 0 && (records[sorted[0].username]?.matches ?? 0) > 0
    ? sorted[0].username
    : null;

  return (
    <div className="friends-page page">
      <div className="friends-header">
        <h1>Friends & Rivals</h1>
        <p>Challenge them online.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="friends-content">
        <div className="friends-list-section">
          <h2>Your Friends</h2>
          <div className="friends-grid">
            {sorted.map(f => (
              <div key={f.username} className="friend-card-wrapper">
                 <FriendCard
                   friend={f}
                   isOnline={!!f.is_online}
                   record={records[f.username]}
                   spotlight={topRival === f.username}
                   busy={busyUser === f.username}
                   waiting={!!outByUser[f.username]}
                   onChallenge={handleChallenge}
                   onRemove={handleRemove}
                 />
              </div>
            ))}
            {sorted.length === 0 && (
              <div className="empty-state">No rivalries yet — add a friend and strike the first battle.</div>
            )}
          </div>
        </div>

        <div className="friends-sidebar">
          {(challengesIn.length > 0 || challengesOut.length > 0) && (
            <div className="card pending-requests-card">
              <h3>Match Challenges</h3>
              <div className="request-list">
                {challengesIn.map(c => (
                  <div key={c.id} className="request-item challenge-item">
                    <span className="request-name">⚔ {c.from_username} <em>({tcLabel(c.time_control_seconds, c.increment_seconds)})</em></span>
                    <span className="challenge-btns">
                      <button className="btn btn-primary btn-sm" disabled={busyChallenge === c.id} onClick={() => handleAcceptChallenge(c)}>Play</button>
                      <button className="btn btn-secondary btn-sm" disabled={busyChallenge === c.id} onClick={() => handleDeclineChallenge(c)}>Decline</button>
                    </span>
                  </div>
                ))}
                {challengesOut.map(c => (
                  <div key={c.id} className="request-item challenge-item">
                    <span className="request-name">⏳ {c.to_username} <em>({tcLabel(c.time_control_seconds, c.increment_seconds)})</em></span>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleChallenge(c.to_username, 0, true)}>Cancel</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card add-friend-card">
            <h3>Add Friend</h3>
            <form onSubmit={handleSendRequest}>
              <div className="form-group">
                <input
                  type="text"
                  placeholder="Username"
                  value={newFriendName}
                  onChange={e => setNewFriendName(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{width: '100%'}}>Send Request</button>
            </form>
          </div>

          {requests.length > 0 && (
            <div className="card pending-requests-card">
              <h3>Pending Requests</h3>
              <div className="request-list">
                {requests.map(r => (
                  <div key={r.from_user} className="request-item">
                    <span className="request-name">{r.from_user}</span>
                    <span className="challenge-btns">
                      <button className="btn btn-primary btn-sm" onClick={() => handleAccept(r.from_user)}>Accept</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleDecline(r.from_user)}>Decline</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sent.length > 0 && (
            <div className="card pending-requests-card">
              <h3>Sent Requests</h3>
              <div className="request-list">
                {sent.map(r => (
                  <div key={r.username} className="request-item">
                    <span className="request-name">{r.username}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleCancelSent(r.username)}>Cancel</button>
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
