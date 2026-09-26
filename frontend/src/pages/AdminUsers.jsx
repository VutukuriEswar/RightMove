import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { adminApi } from '../lib/api';
import { useAuthStore } from '../store/authStore';

function avatarColor(name) {
  const hues = [8, 28, 45, 150, 200, 265, 320];
  let h = 0;
  for (const ch of String(name || '?')) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return `linear-gradient(135deg, hsl(${hues[h % hues.length]}, 45%, 38%), hsl(${(hues[h % hues.length] + 40) % 360}, 50%, 22%))`;
}

export default function AdminUsers() {
  const selfId = useAuthStore((s) => s.user?.id);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [overview, setOverview] = useState(null);
  const [overviewBusy, setOverviewBusy] = useState(false);

  const load = async () => {
    setBusy(true); setError(null);
    try {
      const data = await adminApi.listUsers(q);

      setUsers((data.users || []).filter((u) => u.id !== selfId));
    } catch (e) { setError(e.message || 'Failed to load users'); }
    finally { setBusy(false); }
  };

  useEffect(() => { load(); }, []);

  const openUser = async (id) => {
    setSelectedId(id);
    setOverview(null);
    setOverviewBusy(true);
    try {
      const data = await adminApi.userOverview(id);
      setOverview(data);
    } catch (e) { setError(e.message || 'Overview failed'); }
    finally { setOverviewBusy(false); }
  };

  const closeModal = () => { setSelectedId(null); setOverview(null); };

  const patch = async (id, body) => {
    try {
      const updated = await adminApi.updateUser(id, body);
      setUsers((us) => us.map((u) => (u.id === id ? { ...u, ...updated } : u)));
      if (overview?.user?.id === id) setOverview((o) => ({ ...o, user: { ...o.user, ...updated } }));
    } catch (e) { setError(e.message || 'Update failed'); }
  };

  const modalUser = overview?.user || users.find((u) => u.id === selectedId);

  return (
    <motion.div className="page admin-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="admin-hero">
        <div className="admin-crest">🛡️</div>
        <h1>Knights of the Realm</h1>
        <p>Every registered player, at a glance. Click any card to open their full profile.</p>
      </div>

      <div className="glass-panel admin-toolbar">
        <span className="admin-search-icon">🔍</span>
        <input
          className="admin-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          placeholder="Search by username or email…"
        />
        <button className="btn-neon interactive" onClick={load} disabled={busy}>
          {busy ? 'Seeking…' : 'Search'}
        </button>
        <span className="admin-count">{users.length} player{users.length === 1 ? '' : 's'}</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {busy && users.length === 0 ? (
        <div className="admin-loading"><span className="spinner" /> Summoning players…</div>
      ) : users.length === 0 ? (
        <div className="glass-panel admin-empty">
          <div className="admin-empty-icon">🏜️</div>
          <p>No players found. {q ? 'Try a different search.' : 'New registrations will appear here.'}</p>
        </div>
      ) : (
        <div className="user-grid">
          {users.map((u, i) => (
            <motion.button
              key={u.id}
              className={`user-card interactive ${u.is_blocked ? 'is-blocked' : ''}`}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.5), type: 'spring', stiffness: 120, damping: 17 }}
              whileHover={{ y: -6, scale: 1.015 }}
              onClick={() => openUser(u.id)}
            >
              <div className="user-card-top">
                <span className="user-avatar" style={{ background: avatarColor(u.username) }}>
                  {u.avatar_url
                    ? <img src={u.avatar_url} alt={u.username} />
                    : (u.username?.[0]?.toUpperCase() || '?')}
                </span>
                <span className={`role-badge ${u.role === 'admin' ? 'role-admin' : 'role-user'}`}>
                  {u.role === 'admin' ? '👑 Admin' : '♟ Player'}
                </span>
              </div>
              <div className="user-card-name">{u.display_name || u.username}</div>
              <div className="user-card-handle">@{u.username}</div>
              <div className="user-card-email">{u.email}</div>
              <div className="user-card-foot">
                {u.is_blocked
                  ? <span className="blocked-pill">⛔ Blocked</span>
                  : <span className="active-pill">● Active</span>}
                <span className="view-hint">View profile →</span>
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {createPortal(
        <AnimatePresence>
          {selectedId && (
            <motion.div
              className="admin-modal-overlay"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={closeModal}
            >
              <motion.div
                className="admin-modal"
                initial={{ scale: 0.92, y: 26 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 16 }}
                transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                onClick={(e) => e.stopPropagation()}
              >
                {overviewBusy && !overview ? (
                  <div className="admin-loading"><span className="spinner" /> Opening dossier…</div>
                ) : modalUser ? (
                  <>
                    <button className="admin-modal-close interactive" onClick={closeModal} aria-label="Close">×</button>
                    <div className="ov-head">
                      <span className="user-avatar user-avatar-lg" style={{ background: avatarColor(modalUser.username) }}>
                        {modalUser.avatar_url
                          ? <img src={modalUser.avatar_url} alt={modalUser.username} />
                          : (modalUser.username?.[0]?.toUpperCase() || '?')}
                      </span>
                      <div>
                        <h2>{modalUser.display_name || modalUser.username}</h2>
                        <p className="ov-sub">@{modalUser.username} · {modalUser.email}</p>
                        <div className="ov-badges">
                          <span className={`role-badge ${modalUser.role === 'admin' ? 'role-admin' : 'role-user'}`}>
                            {modalUser.role === 'admin' ? '👑 Admin' : '♟ Player'}
                          </span>
                          {modalUser.is_blocked
                            ? <span className="blocked-pill">⛔ Blocked</span>
                            : <span className="active-pill">● Active</span>}
                        </div>
                      </div>
                    </div>

                    {modalUser.bio && <p className="ov-bio">“{modalUser.bio}”</p>}

                    {(overview?.games_played != null || overview?.game_count != null) && (
                      <div className="ov-stats">
                        <div className="ov-stat">
                          <span className="ov-stat-num">{overview.games_played ?? overview.game_count}</span>
                          <span className="ov-stat-label">Games</span>
                        </div>
                        <div className="ov-stat">
                          <span className="ov-stat-num">{overview.game_count}</span>
                          <span className="ov-stat-label">Recent</span>
                        </div>
                      </div>
                    )}

                    <h4 className="ov-h">Recent battles</h4>
                    <div className="ov-games">
                      {(overview?.recent_games || []).length === 0 && (
                        <p className="coach-text">No games on record yet.</p>
                      )}
                      {(overview?.recent_games || []).map((g) => (
                        <div key={g.id} className="ov-game">
                          <span className="ov-game-mode">{g.mode}</span>
                          <span className={`ov-game-res res-${g.result}`}>{g.result}</span>
                          <span className="ov-game-meta">{g.bot_engine || ''} · {g.started_at ? new Date(g.started_at).toLocaleDateString() : ''}</span>
                        </div>
                      ))}
                    </div>

                    <div className="ov-actions">
                      <button
                        className="btn-neon interactive"
                        style={modalUser.is_blocked ? {} : { background: 'transparent', color: 'var(--royal-crimson, #8B2500)', borderColor: 'var(--royal-crimson, #8B2500)' }}
                        onClick={() => patch(modalUser.id, { is_blocked: !modalUser.is_blocked })}
                      >
                        {modalUser.is_blocked ? '✅ Unblock player' : '⛔ Block player'}
                      </button>
                      <button
                        className="btn-neon interactive"
                        style={{ background: 'transparent' }}
                        onClick={() => patch(modalUser.id, { role: modalUser.role === 'admin' ? 'user' : 'admin' })}
                      >
                        {modalUser.role === 'admin' ? '⬇ Remove admin' : '👑 Make admin'}
                      </button>
                    </div>
                  </>
                ) : null}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </motion.div>
  );
}
