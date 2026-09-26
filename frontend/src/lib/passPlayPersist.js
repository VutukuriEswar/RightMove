function keyFor(gameId) {
  return `rightmove-passplay-${gameId}`;
}

export function savePassPlaySnapshot(gameId, { fen, moves, clocks, timeControlMs }) {
  if (!gameId) return;
  try {
    localStorage.setItem(
      keyFor(gameId),
      JSON.stringify({
        fen,
        moveCount: Array.isArray(moves) ? moves.length : 0,
        clocks,
        timeControlMs,
        savedAt: Date.now(),
      })
    );
  } catch (_) {
  }
}

export function loadPassPlaySnapshot(gameId) {
  if (!gameId) return null;
  try {
    const raw = localStorage.getItem(keyFor(gameId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.moveCount !== 'number') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

export function clearPassPlaySnapshot(gameId) {
  if (!gameId) return;
  try {
    localStorage.removeItem(keyFor(gameId));
  } catch (_) {}
}
