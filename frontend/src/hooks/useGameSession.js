import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';
import {
  getTabId,
  readRegistry,
  writeRegistry,
  clearRegistry,
  isFresh,
  isDismissed,
  getChannel,
  tryCloseWindow,
  HEARTBEAT_MS,
} from '../lib/gameSession';

function activeSnapshot() {
  const g = useGameStore.getState();
  return { gameId: g.gameId, result: g.result, opponent: g.opponentUsername ?? null };
}

function myUserId() {
  try {
    return useAuthStore.getState().user?.id ?? null;
  } catch (_) {
    return null;
  }
}

export function useGameSession() {
  useEffect(() => {
    const tabId = getTabId();
    useSessionStore.getState().setTabId(tabId);

    const tick = (myTab) => {
      const st = useSessionStore.getState();
      if (st.movedAway || st.idle) return;
      const uid = myUserId();
      if (!uid) {
        if (st.prompt) st.setPrompt(null);
        return;
      }
      const s = activeSnapshot();
      if (st.owned) {
        if (!s.gameId || s.result) {
          clearRegistry(myTab);
          st.setOwned(false);
        } else {
          writeRegistry({ tabId: myTab, userId: uid, gameId: s.gameId, opponent: s.opponent, active: true });
        }
        return;
      }
      const entry = readRegistry();
      const foreignLive = entry && isFresh(entry) && entry.tabId !== myTab && entry.userId === uid && entry.active;
      if (!foreignLive) {
        if (st.prompt) st.setPrompt(null);
        if (st.suspended) st.setSuspended(false);
        if (s.gameId && !s.result && !isDismissed(s.gameId)) {
          st.setOwned(true);
          writeRegistry({ tabId: myTab, userId: uid, gameId: s.gameId, opponent: s.opponent, active: true });
        }
        return;
      }
      if (isDismissed(entry.gameId)) return;
      const cur = st.prompt;
      if (!cur || cur.gameId !== entry.gameId) {
        st.setPrompt({ gameId: entry.gameId, opponent: entry.opponent ?? null });
      }
      if (!st.suspended) st.setSuspended(true);
    };

    const onMessage = (event) => {
      const msg = event?.data;
      if (!msg || msg.from === tabId) return;
      if (msg.type === 'takeover' && msg.gameId) {
        const s = activeSnapshot();
        if (s.gameId && s.gameId === msg.gameId && !s.result) {
          const st = useSessionStore.getState();
          st.setMovedAway(true);
          st.setOwned(false);
          st.setSuspended(true);
          st.setPrompt(null);
          clearRegistry(tabId);
          tryCloseWindow();
        }
      }
    };

    const onStorage = (e) => {
      if (!e.key || e.key === 'rm_game_session') tick(tabId);
    };

    const onUnload = () => {
      const st = useSessionStore.getState();
      if (st.owned) clearRegistry(tabId);
    };

    const ch = getChannel();
    if (ch) ch.onmessage = onMessage;
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);

    tick(tabId);
    const t = setInterval(() => tick(tabId), HEARTBEAT_MS);
    return () => {
      clearInterval(t);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
      if (ch) ch.onmessage = null;
    };
  }, []);
}
