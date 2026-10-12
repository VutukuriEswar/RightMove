import React from 'react';
import { createPortal } from 'react-dom';
import { useLeaveGameStore } from '../../store/leaveGameStore';

export default function LeaveGameDialog() {
  const isOpen = useLeaveGameStore((s) => s.isOpen);
  const onConfirm = useLeaveGameStore((s) => s.onConfirm);
  const onCancel = useLeaveGameStore((s) => s.onCancel);

  if (!isOpen) return null;

  return createPortal(
    <div className="ready-modal-overlay">
      <div className="ready-modal" role="dialog" aria-modal="true" aria-label="Leave game?">
        <div className="ready-modal-crest">♞</div>
        <h2>Leave the game?</h2>
        <p>Leaving now counts as a loss — the opponent will be awarded the win.</p>
        <div className="modal-btn-row">
          <button
            className="btn-neon interactive"
            style={{ flex: 1, padding: '12px 0' }}
            onClick={() => onCancel?.()}
          >
            Stay &amp; Continue
          </button>
          <button
            className="btn-neon interactive"
            style={{
              flex: 1,
              padding: '12px 0',
              background: 'transparent',
              borderColor: 'var(--royal-crimson, #8B2500)',
              color: 'var(--royal-crimson, #8B2500)',
            }}
            onClick={() => onConfirm?.()}
          >
            Leave Game
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
