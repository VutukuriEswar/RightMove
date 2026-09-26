let _resignFn = null;

export function setActiveGameResigner(fn) {
  _resignFn = typeof fn === 'function' ? fn : null;
}

export function clearActiveGameResigner(fn) {
  if (!fn || _resignFn === fn) _resignFn = null;
}

export function resignActiveGame() {
  if (!_resignFn) return false;
  try {
    _resignFn();
  } catch (_) {
  }
  return true;
}

export function hasActiveGameResigner() {
  return !!_resignFn;
}
