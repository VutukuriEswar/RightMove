import React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../store/sessionStore';
import { useAuthStore } from '../../store/authStore';
import {
  getTabId,
  writeRegistry,
  postSessionMessage,
  markDismissed,
  tryCloseWindow,
} from '../../lib/gameSession';

export default function GameSessionDialog() {
  const navigate = useNavigate();
  const prompt = useSessionStore((s) => s.prompt);
  const movedAway = useSessionStore((s) => s.movedAway);
  const idle = useSessionStore((s) => s.idle);

  const moveHere = () => {
    const st = useSessionStore.getState();
    const target = st.prompt;
    let uid = null;
    try {
      uid = useAuthStore.getState().user?.id ?? null;
    } catch (_) {
      uid = null;
    }
    if (!target || !uid) return;
    const tabId = st.tabId || getTabId();
    writeRegistry({ tabId, userId: uid, gameId: target.gameId, opponent: target.opponent ?? null, active: true });
    postSessionMessage({ type: 'takeover', from: tabId, gameId: target.gameId });
    st.setOwned(true);
    st.setSuspended(false);
    st.setPrompt(null);
    if (window.location.pathname !== `/game/${target.gameId}`) {
      navigate(`/game/${target.gameId}`);
    }
  };

  const stayIdle = () => {
    const st = useSessionStore.getState();
    if (st.prompt) markDismissed(st.prompt.gameId);
    st.setPrompt(null);
    st.setIdle(true);
    st.setSuspended(true);
    tryCloseWindow();
  };

  if (!prompt && !movedAway && !idle) return null;

  return createPortal(
    <div className="ready-modal-overlay">
      <div className="ready-modal" role="dialog" aria-modal="true" aria-label="Game session">
        <div className="ready-modal-crest">♞</div>
        {prompt && (
          <>
            <h2>Game in another tab</h2>
            <p>
              You are already playing a game{prompt.opponent ? ` against ${prompt.opponent}` : ''} in another tab.
              Do you want to move it here and continue from where it left off?
            </p>
            <div className="modal-btn-row">
              <button
                className="btn-neon interactive"
                style={{ flex: 1, padding: '12px 0' }}
                onClick={moveHere}
              >
                Yes, move it here
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
                onClick={stayIdle}
              >
                No, close this tab
              </button>
            </div>
          </>
        )}
        {movedAway && (
          <>
            <h2>Game moved</h2>
            <p>This game was moved to your other tab and continues there with the clock running.</p>
            <div className="modal-btn-row">
              <button
                className="btn-neon interactive"
                style={{ flex: 1, padding: '12px 0' }}
                onClick={tryCloseWindow}
              >
                Close this tab
              </button>
            </div>
          </>
        )}
        {idle && !movedAway && (
          <>
            <h2>Staying put</h2>
            <p>Your game stays in the other tab. You can safely close this tab.</p>
            <div className="modal-btn-row">
              <button
                className="btn-neon interactive"
                style={{ flex: 1, padding: '12px 0' }}
                onClick={tryCloseWindow}
              >
                Close this tab
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
