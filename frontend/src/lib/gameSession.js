const REGISTRY_KEY = 'rm_game_session';
const DISMISS_PREFIX = 'rm_session_dismissed_';
const TAB_KEY = 'rm_tab_id';
const CHANNEL_NAME = 'rightmove-game-session';
const HEARTBEAT_MS = 1000;
const FRESH_MS = 8000;

export function getTabId() {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = crypto.randomUUID();
      } else {
        id = String(Date.now()) + '-' + String(Math.random()).slice(2);
      }
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch (_) {
    return 'tab-' + String(Math.random()).slice(2);
  }
}

export function readRegistry() {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.tabId || !entry.gameId) return null;
    return entry;
  } catch (_) {
    return null;
  }
}

export function writeRegistry(entry) {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify({ ...entry, ts: Date.now() }));
  } catch (_) {}
}

export function clearRegistry(tabId) {
  try {
    const cur = readRegistry();
    if (cur && cur.tabId === tabId) localStorage.removeItem(REGISTRY_KEY);
  } catch (_) {}
}

export function isFresh(entry) {
  if (!entry || !entry.ts) return false;
  return Date.now() - entry.ts < FRESH_MS;
}

export function isDismissed(gameId) {
  try {
    return sessionStorage.getItem(DISMISS_PREFIX + gameId) === '1';
  } catch (_) {
    return false;
  }
}

export function markDismissed(gameId) {
  try {
    sessionStorage.setItem(DISMISS_PREFIX + gameId, '1');
  } catch (_) {}
}

let channel = null;

export function getChannel() {
  if (typeof window === 'undefined') return null;
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch (_) {
      channel = null;
    }
  }
  return channel;
}

export function postSessionMessage(msg) {
  try {
    const ch = getChannel();
    if (ch) ch.postMessage(msg);
  } catch (_) {}
}

export function tryCloseWindow() {
  try {
    window.close();
  } catch (_) {}
}

export { HEARTBEAT_MS, FRESH_MS };
