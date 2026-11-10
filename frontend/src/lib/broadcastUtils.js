const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const DATE_TIME_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatEventDates(dates) {
  const parsed = (dates || []).map(parseDate).filter(Boolean);
  if (!parsed.length) return '';
  if (parsed.length === 1) return DATE_FMT.format(parsed[0]);
  return `${DATE_FMT.format(parsed[0])} – ${DATE_FMT.format(parsed[parsed.length - 1])}`;
}

export function formatRoundDate(value) {
  const d = parseDate(value);
  return d ? DATE_TIME_FMT.format(d) : '';
}

export function relativeTime(value) {
  const d = parseDate(value);
  if (!d) return '';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let text;
  if (mins < 1) text = 'just now';
  else if (mins < 60) text = `${mins} min`;
  else if (hours < 24) text = `${hours} hr`;
  else text = `${days} day${days === 1 ? '' : 's'}`;
  if (text === 'just now') return text;
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

export function eventStatus(event) {
  if (!event) return { key: 'past', label: 'Recent' };
  if (event.is_live) return { key: 'live', label: 'Live now' };
  if (event.is_upcoming) return { key: 'upcoming', label: 'Upcoming' };
  return { key: 'past', label: 'Finished' };
}

export function tierLabel(tier) {
  const n = Number(tier || 0);
  if (n >= 5) return 'Top tier';
  if (n >= 4) return 'Major';
  if (n >= 3) return 'Notable';
  return '';
}

export function resultLabel(result) {
  if (result === '1-0') return '1–0';
  if (result === '0-1') return '0–1';
  if (result === '½-½' || result === '1/2-1/2') return '½–½';
  return '*';
}

export function gameResultClass(result) {
  if (result === '1-0') return 'white';
  if (result === '0-1') return 'black';
  if (result === '½-½' || result === '1/2-1/2') return 'draw';
  return 'live';
}

export function analysisAttribution(analysis) {
  if (!analysis) return '';
  if (analysis.auto || analysis.analyzed_by === 'auto' || !analysis.analyzed_by) {
    return 'Auto-analyzed';
  }
  return `Analyzed by @${analysis.analyzed_by}`;
}

export function lastMoveSquares(lastMove) {
  if (!lastMove) return null;
  if (typeof lastMove === 'string' && lastMove.length >= 4) {
    return { from: lastMove.slice(0, 2), to: lastMove.slice(2, 4) };
  }
  if (Array.isArray(lastMove) && lastMove.length >= 2) {
    return { from: lastMove[0], to: lastMove[1] };
  }
  if (lastMove.from && lastMove.to) {
    return { from: lastMove.from, to: lastMove.to };
  }
  return null;
}

export function formatEvalCp(cp) {
  const n = Number(cp ?? 0);
  const pawns = n / 100;
  if (Math.abs(n) >= 9000) {
    return n > 0 ? '+M' : '-M';
  }
  return pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
}

export function formatBroadcastClock(ms) {
  if (ms == null || Number.isNaN(ms)) return '';
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function parseClockStrToMs(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(':').map((v) => Number(v));
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 3) {
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }
  if (parts.length === 2) {
    return (parts[0] * 60 + parts[1]) * 1000;
  }
  return null;
}
