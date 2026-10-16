const DB_NAME = 'rightmove_review';
const DB_VERSION = 1;
const STORE_NAME = 'move_cache';
const MAX_ENTRIES = 500;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, mode);
    const req = fn(t.objectStore(STORE_NAME));
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function prune(db) {
  return run(db, 'readonly', (s) => s.getAll())
    .then((all) => {
      if (!all || all.length <= MAX_ENTRIES) return null;
      const sorted = [...all].sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
      const excess = sorted.slice(0, all.length - MAX_ENTRIES);
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE_NAME, 'readwrite');
        excess.forEach((r) => t.objectStore(STORE_NAME).delete(r.key));
        t.oncomplete = () => resolve(null);
        t.onerror = (e) => reject(e.target.error);
      });
    })
    .catch(() => null);
}

export function moveCacheKey(gameId, ply) {
  return `${gameId}:${ply}`;
}

export async function getCachedMove(key) {
  const db = await openDB();
  try {
    return (await run(db, 'readonly', (s) => s.get(key))) || null;
  } finally {
    db.close();
  }
}

export async function setCachedMove(key, data) {
  const db = await openDB();
  try {
    await run(db, 'readwrite', (s) => s.put({ key, savedAt: Date.now(), ...data }));
    await prune(db);
  } finally {
    db.close();
  }
}
