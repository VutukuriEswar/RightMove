import { Chess } from 'chess.js';

export const CLASSIFICATION_META = {
  brilliant:  { label: 'Brilliant',  emoji: '!!', color: 'var(--color-brilliant)' },
  best:       { label: 'Best',       emoji: '!',  color: 'var(--color-best)' },
  excellent:  { label: 'Excellent',  emoji: '!',  color: 'var(--color-excellent)' },
  good:       { label: 'Good',       emoji: '',   color: 'var(--color-good)' },
  inaccuracy: { label: 'Inaccuracy', emoji: '?!', color: 'var(--color-inaccuracy)' },
  mistake:    { label: 'Mistake',    emoji: '?',  color: 'var(--color-mistake)' },
  blunder:    { label: 'Blunder',    emoji: '??', color: 'var(--color-blunder)' },
};

export function buildPositions(sanMoves) {
  const chess = new Chess();
  const positions = [chess.fen()];
  for (const san of sanMoves) {
    try {
      chess.move(san);
      positions.push(chess.fen());
    } catch {
      break;
    }
  }
  return positions;
}

export function formatEval(cp, isMate = false) {
  if (cp === null || cp === undefined || Number.isNaN(Number(cp))) return '+0.00';
  const n = Number(cp);
  if (isMate) return n > 0 ? `#${n}` : `#${n}`;
  const pawns = n / 100;
  return pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
}

export function isValidSquare(sq) {
  return typeof sq === 'string' && /^[a-h][1-8]$/.test(sq);
}

export function uciToSquares(uci) {
  if (typeof uci !== 'string' || uci.length < 4) return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  if (!isValidSquare(from) || !isValidSquare(to)) return null;
  return [from, to];
}

export function moveRecordToSquares(move) {
  if (!move || typeof move !== 'object') return null;
  const from = move.from_sq || move.from;
  const to = move.to_sq || move.to;
  if (isValidSquare(from) && isValidSquare(to)) return { from, to };
  if (typeof move.uci === 'string') {
    const sqs = uciToSquares(move.uci);
    if (sqs) return { from: sqs[0], to: sqs[1] };
  }
  return null;
}

export function formatClock(ms) {
  if (ms <= 0) return '0:00.00';
  const totalCs = Math.floor(ms / 10);
  const cs      = totalCs % 100;
  const totalS  = Math.floor(totalCs / 100);
  const secs    = totalS % 60;
  const mins    = Math.floor(totalS / 60);
  return `${mins}:${secs.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export function buildPgn(sans, meta = {}) {
  const lines = [
    '[Event "RightMove Game"]',
    '[Site "RightMove"]',
    `[White "${meta.white || 'White'}"]`,
    `[Black "${meta.black || 'Black'}"]`,
    `[Result "${meta.result || '*'}"]`,
    '',
  ];
  const body = [];
  for (let i = 0; i < sans.length; i += 2) {
    const moveNum = i / 2 + 1;
    body.push(`${moveNum}. ${sans[i]}${sans[i + 1] ? ` ${sans[i + 1]}` : ''}`);
  }
  if (meta.result && meta.result !== '*') {
    body.push(meta.result);
  }
  lines.push(body.join(' '));
  return lines.join('\n');
}
const DB_NAME = 'rightmove_games';
const DB_VERSION = 1;
const STORE_NAME = 'move_logs';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'game_id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function saveGameLog(gameId, moves, meta = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      game_id: gameId,
      moves,
      saved_at: Date.now(),
      opponent: meta.opponent || 'Unknown',
      result:   meta.result   || null,
      mode:     meta.mode     || null,
      player_color: meta.player_color || meta.playerColor || null,
    });
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function loadGameLog(gameId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(gameId);
    req.onsuccess = (e) => resolve(e.target.result?.moves || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function listSavedGames() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function deleteGameLog(gameId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(gameId);
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

function _utf8Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return binary;
}

function _utf8Decode(binary) {
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeSharePayload(obj) {
  const json = JSON.stringify(obj);
  return btoa(_utf8Encode(json))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeSharePayload(fragment) {
  let s = String(fragment || '');
  try { s = decodeURIComponent(s); } catch (_) {}
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  return JSON.parse(_utf8Decode(atob(s)));
}

export function slimGameForShare(game) {
  const moves = (game.moves || []).map((m) => ({ uci: m.uci, san: m.san }));
  return {
    id: game.game_id,
    moves,
    meta: {
      result: game.result,
      mode: game.mode,
      opponent: game.opponent,
      date: game.saved_at,
    },
  };
}

export function buildShareUrl(game) {
  const payload = encodeSharePayload(slimGameForShare(game));
  return `${window.location.origin}/shared/${game.game_id}#${payload}`;
}

export async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error('clipboard API unavailable');
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (_) {
      return false;
    }
  }
}
