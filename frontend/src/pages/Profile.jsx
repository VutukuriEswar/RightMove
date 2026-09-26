import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { useAuthStore } from '../store/authStore';
import { authApi, gamesApi } from '../lib/api';
import { listSavedGames } from '../lib/chessUtils';
import BoardThemePicker from '../components/board/BoardThemePicker';

function Avatar({ src, initial, onClick }) {
  return (
    <motion.button
      className="profile-avatar-large interactive"
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.96 }}
      title="Click to change profile picture"
    >
      {src ? (
        <img src={src} alt="Profile" className="profile-avatar-img" />
      ) : (
        <span className="profile-avatar-initial">{initial}</span>
      )}
      <span className="profile-avatar-overlay">
        <span className="profile-avatar-camera">📷</span>
      </span>
    </motion.button>
  );
}

function Field({ id, label, type = 'text', value, onChange, placeholder, hint, readOnly = false, maxLength }) {
  return (
    <div className="pf-field">
      <label className="pf-label" htmlFor={id}>{label}</label>
      {readOnly ? (
        <div className="pf-input pf-input--readonly">{value}</div>
      ) : (
        <input
          id={id}
          className="pf-input interactive"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete={type === 'password' ? 'new-password' : undefined}
        />
      )}
      {hint && <p className="pf-hint">{hint}</p>}
    </div>
  );
}

function computeLocalStats(games) {
  let wins = 0, draws = 0, losses = 0;
  (games || []).forEach((g) => {
    const result = g?.result;
    const color = g?.player_color || g?.playerColor || null;
    if (result === 'draw' && (color === 'white' || color === 'black')) {
      draws += 1;
    } else if (
      (result === 'white' || result === 'black') &&
      (color === 'white' || color === 'black')
    ) {
      if (result === color) wins += 1;
      else losses += 1;
    }
  });
  return { wins, draws, losses };
}

export default function Profile() {
  const { user } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);
  const avatarInputRef = useRef(null);

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail]             = useState('');
  const [bio, setBio]                 = useState('');
  const [currentPw, setCurrentPw]     = useState('');
  const [newPw, setNewPw]             = useState('');
  const [confirmPw, setConfirmPw]     = useState('');

  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState(null);
  const [uploading, setUploading]     = useState(false);
  const [showPwSection, setShowPwSection] = useState(false);
  const [activeSection, setActiveSection] = useState('profile');
  const [stats, setStats]             = useState({ wins: 0, draws: 0, losses: 0 });
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsSource, setStatsSource] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      if (!user) {
        if (!cancelled) {
          setStats({ wins: 0, draws: 0, losses: 0 });
          setStatsLoading(false);
        }
        return;
      }
      setStatsLoading(true);
      try {
        const live = await gamesApi.getMyStats();
        if (cancelled) return;
        setStats({
          wins: Number(live?.wins) || 0,
          draws: Number(live?.draws) || 0,
          losses: Number(live?.losses) || 0,
        });
        setStatsSource('live');
      } catch (_) {

        try {
          const local = await listSavedGames();
          if (cancelled) return;
          setStats(computeLocalStats(local));
          setStatsSource('local');
        } catch (_) {
          if (cancelled) return;
          setStats({ wins: 0, draws: 0, losses: 0 });
          setStatsSource(null);
        }
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }
    loadStats();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || '');
      setEmail(user.email || '');
      setBio(user.bio || '');
    }
  }, [user]);

  const showMessage = useCallback((type, text) => {
    setSaveMsg({ type, text });
    setTimeout(() => setSaveMsg(null), 4000);
  }, []);

  const handleSave = async () => {
    if (newPw && newPw !== confirmPw) {
      showMessage('error', 'New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const updates = {
        display_name: displayName || null,
        email: email !== user.email ? email : undefined,
        bio: bio || null,
        ...(newPw ? { current_password: currentPw, new_password: newPw } : {}),
      };
      Object.keys(updates).forEach((k) => updates[k] === undefined && delete updates[k]);
      await authApi.updateProfile(updates);
      const fresh = await authApi.me();
      setUser(fresh);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setShowPwSection(false);
      showMessage('success', 'Profile updated successfully!');
    } catch (err) {
      showMessage('error', err.message || 'Update failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await authApi.uploadAvatar(file);
      const fresh = await authApi.me();
      setUser(fresh);
      showMessage('success', 'Profile picture updated!');
    } catch (err) {
      showMessage('error', err.message || 'Upload failed.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (!user) return <div className="page"><p>Please log in.</p></div>;

  const displayInitial = (user.display_name || user.username || '?')[0].toUpperCase();

  return (
    <div className="profile-page page">

      <div className="profile-banner">

        <div className="profile-avatar-wrap">
          {uploading ? (
            <div className="profile-avatar-large"><div className="spinner-sm" /></div>
          ) : (
            <Avatar
              src={user.avatar_url}
              initial={displayInitial}
              onClick={() => avatarInputRef.current?.click()}
            />
          )}
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarChange}
            id="avatar-file-input"
          />
          <p className="profile-avatar-hint">Click to change</p>
        </div>

        <div className="profile-identity">
          <h1 className="profile-display-name">
            {user.display_name || user.username}
          </h1>
          <p className="profile-username">@{user.username}</p>
          <p className="profile-email">{user.email}</p>
          {user.bio && <p className="profile-bio">"{user.bio}"</p>}
        </div>

        <div className="profile-record">
          <div className="profile-record-title" title={statsSource === 'local' ? 'Offline — from this device' : 'From finished games'}>Record</div>
          <div className="profile-record-stats">
            <div className="profile-stat">
              <div className="profile-stat-value win">{statsLoading ? '–' : stats.wins}</div>
              <div className="profile-stat-label">Wins</div>
            </div>
            <div className="profile-stat-divider" />
            <div className="profile-stat">
              <div className="profile-stat-value draw">{statsLoading ? '–' : stats.draws}</div>
              <div className="profile-stat-label">Draws</div>
            </div>
            <div className="profile-stat-divider" />
            <div className="profile-stat">
              <div className="profile-stat-value loss">{statsLoading ? '–' : stats.losses}</div>
              <div className="profile-stat-label">Losses</div>
            </div>
          </div>
        </div>
      </div>

      <div className="profile-section-tabs">
        <button
          id="profile-tab-profile"
          className={`profile-section-tab interactive ${activeSection === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveSection('profile')}
        >
          ✦ Edit Profile
        </button>
        <button
          id="profile-tab-board"
          className={`profile-section-tab interactive ${activeSection === 'board' ? 'active' : ''}`}
          onClick={() => setActiveSection('board')}
        >
          🎨 Board Style
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeSection === 'profile' ? (
          <motion.div
            key="profile"
            className="profile-form-card"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
          >
            <div className="pf-fields-grid">
              <Field id="pf-username" label="Username (cannot be changed)" value={user.username} readOnly />
              <Field
                id="pf-display-name"
                label="Display Name"
                value={displayName}
                onChange={setDisplayName}
                placeholder="How others see you"
                maxLength={64}
                hint="Leave blank to show username"
              />
              <Field
                id="pf-email"
                label="Email Address"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="your@email.com"
              />
              <div className="pf-field pf-field--full">
                <label className="pf-label" htmlFor="pf-bio">Bio</label>
                <textarea
                  id="pf-bio"
                  className="pf-input pf-textarea interactive"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell others about yourself…"
                  maxLength={500}
                  rows={3}
                />
                <p className="pf-hint">{bio.length}/500</p>
              </div>
            </div>

            <button
              className="pf-toggle-pw interactive"
              onClick={() => setShowPwSection(p => !p)}
            >
              {showPwSection ? '▲ Hide' : '▼ Change Password'}
            </button>

            <AnimatePresence>
              {showPwSection && (
                <motion.div
                  key="pw"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="pf-pw-block">
                    <Field id="pf-cur-pw" label="Current Password" type="password" value={currentPw} onChange={setCurrentPw} placeholder="••••••••" />
                    <Field id="pf-new-pw" label="New Password" type="password" value={newPw} onChange={setNewPw} placeholder="Min 8 characters" maxLength={128} />
                    <Field id="pf-confirm-pw" label="Confirm New Password" type="password" value={confirmPw} onChange={setConfirmPw} placeholder="Repeat new password" maxLength={128} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {saveMsg && (
                <motion.div
                  key="msg"
                  className={`pf-save-msg pf-save-msg--${saveMsg.type}`}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {saveMsg.type === 'success' ? '✓' : '⚠'} {saveMsg.text}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              id="profile-save-btn"
              className="btn-neon interactive pf-save-btn"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="board"
            className="profile-theme-card"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
          >
            <BoardThemePicker inline />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
