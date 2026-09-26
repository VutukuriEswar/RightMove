import React, { useState, useEffect } from 'react';
import { friendsApi } from '../lib/api';
import FriendCard from '../components/friends/FriendCard';

export default function Friends() {
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [newFriendName, setNewFriendName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const loadFriends = () => {
    friendsApi.list()
      .then(data => {
        setFriends(data.friends || []);
        setRequests(data.pending_requests || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadFriends();
  }, []);

  const handleSendRequest = async (e) => {
    e.preventDefault();
    if (!newFriendName.trim()) return;
    setError(null);
    setSuccess(null);
    try {
      await friendsApi.sendRequest(newFriendName.trim());
      setSuccess(`Friend request sent to ${newFriendName}!`);
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

  if (loading) return <div className="page"><div className="spinner-large" /></div>;

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
            {friends.map(f => (
              <div key={f.username} className="friend-card-wrapper">
                 <FriendCard
                   friend={f}
                   isOnline={false}
                 />
              </div>
            ))}
            {friends.length === 0 && (
              <div className="empty-state">You haven't added any friends yet.</div>
            )}
          </div>
        </div>

        <div className="friends-sidebar">
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
                    <button className="btn btn-primary btn-sm" onClick={() => handleAccept(r.from_user)}>Accept</button>
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
