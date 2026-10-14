import React from 'react';
import { createPortal } from 'react-dom';
import { useLeaveGameStore } from '../../store/leaveGameStore';
import { useGameStore } from '../../store/gameStore';

export default function LeaveGameDialog() {
  const isOpen = useLeaveGameStore((s) => s.isOpen);
  const onConfirm = useLeaveGameStore((s) => s.onConfirm);
  const onCancel = useLeaveGameStore((s) => s.onCancel);
  const mode = useGameStore((s) => s.mode);
  const playerColor = useGameStore((s) => s.playerColor);
  const fen = useGameStore((s) => s.fen);
  const opponentUsername = useGameStore((s) => s.opponentUsername);

  if (!isOpen) return null;

  let winner = opponentUsername || 'your opponent';
  if (mode === 'bot') {
    winner = 'Coach';
  } else if (mode === 'pass_and_play') {
    const toMove = String(fen || '').split(' ')[1] === 'b' ? 'black' : 'white';
    winner = toMove === 'white' ? 'Black' : 'White';
  } else if (playerColor === 'white' || playerColor === 'black') {
    winner = opponentUsername || (playerColor === 'white' ? 'Black' : 'White');
  }

  return createPortal(
    <div className="ready-modal-overlay">
      <div className="ready-modal" role="dialog" aria-modal="true" aria-label="Leave game?">
        <div className="ready-modal-crest">♞</div>
        <h2>Leave the game?</h2>
        <p>Leaving now counts as a loss — the opponent will be awarded the win.</p>
        <p>If you leave, you will automatically resign the match and {winner} will win the match.</p>
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
