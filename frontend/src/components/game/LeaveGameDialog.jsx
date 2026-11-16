import React from 'react';
import { createPortal } from 'react-dom';
import { useLeaveGameStore } from '../../store/leaveGameStore';
import { useGameStore } from '../../store/gameStore';

export default function LeaveGameDialog() {
  const isOpen = useLeaveGameStore((s) => s.isOpen);
  const onConfirm = useLeaveGameStore((s) => s.onConfirm);
  const onCancel = useLeaveGameStore((s) => s.onCancel);
  const onPause = useLeaveGameStore((s) => s.onPause);
  const canPause = useLeaveGameStore((s) => s.canPause);
  const mode = useGameStore((s) => s.mode);
  const trainingMode = useGameStore((s) => s.trainingMode);
  const playerColor = useGameStore((s) => s.playerColor);
  const fen = useGameStore((s) => s.fen);
  const opponentUsername = useGameStore((s) => s.opponentUsername);

  if (!isOpen) return null;

  const isPausable = canPause || mode === 'pass_and_play' || mode === 'friend' || mode === 'bot' || !!trainingMode;

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
      <div
        className={`ready-modal${isPausable ? ' ready-modal-pausable' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={isPausable ? 'Pause or leave game?' : 'Leave game?'}
      >
        <div className="ready-modal-crest">{isPausable ? '⏸' : '♞'}</div>
        <h2>{isPausable ? 'Pause or Leave Game?' : 'Leave the game?'}</h2>
        {isPausable ? (
          <>
            <p>You have an active match in progress.</p>
            <p>You can pause this match to continue later, stay on the board, or leave and resign.</p>
          </>
        ) : (
          <>
            <p>Leaving now counts as a loss — the opponent will be awarded the win.</p>
            <p>If you leave, you will automatically resign the match and {winner} will win the match.</p>
          </>
        )}
        <div className={`modal-btn-row${isPausable ? ' modal-btn-row-pausable' : ''}`}>
          <button
            className="btn-neon interactive"
            style={{ flex: isPausable ? '1 1 100%' : 1, padding: '12px 0' }}
            onClick={() => onCancel?.()}
          >
            Stay &amp; Continue
          </button>
          {isPausable && (
            <button
              className="btn-neon interactive"
              style={{
                flex: '1 1 130px',
                padding: '12px 0',
                background: 'rgba(212, 175, 55, 0.16)',
                borderColor: 'var(--royal-gold, #D4AF37)',
                color: 'var(--royal-gold, #D4AF37)',
              }}
              onClick={() => onPause?.()}
            >
              ⏸ Pause &amp; Leave
            </button>
          )}
          <button
            className="btn-neon interactive"
            style={{
              flex: isPausable ? '1 1 130px' : 1,
              padding: '12px 0',
              background: 'transparent',
              borderColor: 'var(--royal-crimson, #8B2500)',
              color: 'var(--royal-crimson, #8B2500)',
            }}
            onClick={() => onConfirm?.()}
          >
            {isPausable ? 'Leave & Resign' : 'Leave Game'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
