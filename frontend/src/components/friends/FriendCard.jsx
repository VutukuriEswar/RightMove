import React, { useState } from 'react';
import { motion } from 'framer-motion';

const FORM_CLASS = { win: 'form-w', draw: 'form-d', loss: 'form-l' };
const FORM_LABEL = { win: 'Won', draw: 'Drew', loss: 'Lost' };

const TC_OPTIONS = [
  { label: '1m', tc: 60 },
  { label: '5m', tc: 300 },
  { label: '10m', tc: 600 },
  { label: '30m', tc: 1800 },
];

export default function FriendCard({ friend, isOnline, record, spotlight, busy, waiting, onChallenge, onRemove }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [tc, setTc] = useState(600);

  const matches = record?.matches ?? null;
  const hasBattles = matches !== null && matches > 0;

  return (
    <motion.div
      className={`friend-card card${spotlight ? ' friend-spotlight' : ''}`}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
    >
      {spotlight && <span className="spotlight-label">Top Rival</span>}
      <div className="friend-avatar">
        {friend.username[0].toUpperCase()}
        <span className={`friend-status-dot ${isOnline ? 'online' : 'offline'}`} title={isOnline ? 'Online' : 'Offline'} />
      </div>

      <div className="friend-info">
        <span className="friend-name">{friend.username}</span>
        {record && hasBattles && (
          <span className="rivalry-badge">{record.title}</span>
        )}
        {record && (
          <span className="friend-record">
            {hasBattles
              ? `${matches} match${matches === 1 ? '' : 'es'} · ${record.wins}W–${record.draws}D–${record.losses}L`
              : 'No battles yet — strike first.'}
          </span>
        )}
        {record && hasBattles && record.form?.length > 0 && (
          <span className="friend-form">
            {record.form.map((r, i) => (
              <span key={i} className={`form-dot ${FORM_CLASS[r] || 'form-d'}`} title={FORM_LABEL[r] || r} />
            ))}
            <span className="friend-form-label">form</span>
          </span>
        )}
        {record && record.milestones?.length > 0 && (
          <span className="friend-milestones">
            {record.milestones.map((m, i) => (
              <span key={i} className="milestone-pill">{m}</span>
            ))}
          </span>
        )}
        {record?.favorite_opener && (
          <span className="friend-opener">
            Loves opening {record.favorite_opener.move} ({record.favorite_opener.times}/{record.favorite_opener.of_games})
          </span>
        )}
      </div>

      <div className="friend-actions">
        {waiting ? (
          <button
            className="btn-sm interactive"
            disabled={busy}
            title="Challenge sent — waiting for them to accept"
            onClick={() => onChallenge?.(friend.username, tc, true)}
          >
            {busy ? '...' : '⏳ Waiting — Cancel?'}
          </button>
        ) : (
          <>
            <select
              className="tc-mini interactive"
              value={tc}
              disabled={busy}
              aria-label="Time control"
              title="Time control for the challenge"
              onChange={(e) => setTc(Number(e.target.value))}
            >
              {TC_OPTIONS.map((o) => (
                <option key={o.tc} value={o.tc}>{o.label}</option>
              ))}
            </select>
            <button
              className="btn-sm interactive"
              disabled={busy}
              title={`Challenge ${friend.username} to a game`}
              onClick={() => onChallenge?.(friend.username, tc, false)}
            >
              {busy ? '...' : '⚔ Challenge'}
            </button>
          </>
        )}
        {confirmRemove ? (
          <>
            <button
              className="btn-sm interactive btn-danger-ghost"
              disabled={busy}
              title="Confirm removal"
              onClick={() => { setConfirmRemove(false); onRemove?.(friend.username); }}
            >
              Sure?
            </button>
            <button
              className="btn-sm interactive"
              disabled={busy}
              onClick={() => setConfirmRemove(false)}
            >
              Keep
            </button>
          </>
        ) : (
          <button
            className="btn-sm interactive btn-ghost"
            disabled={busy}
            title={`Remove ${friend.username}`}
            onClick={() => setConfirmRemove(true)}
          >
            Remove
          </button>
        )}
      </div>
    </motion.div>
  );
}
