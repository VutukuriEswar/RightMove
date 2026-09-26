import React from 'react';

export default function WdlBar({ userWin = 50, draw = 25, botWin = 25, userLabel = 'You', botLabel = 'Bot' }) {
  const toPct = (v, fb) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fb;
    return n <= 1.2 && n > 0 ? n * 100 : n;
  };
  const u0 = Math.max(0, toPct(userWin, 50));
  const d0 = Math.max(0, toPct(draw, 25));
  const b0 = Math.max(0, toPct(botWin, 25));
  const total = Math.max(0.0001, u0 + d0 + b0);
  const u = (u0 / total) * 100;
  const d = (d0 / total) * 100;
  const b = Math.max(0, 100 - u - d);
  return (
    <div className="wdl-wrap">
      <div className="wdl-bar" role="img" aria-label={`${userLabel} ${Math.round(u0)}% draw ${Math.round(d0)}% ${botLabel} ${Math.round(b0)}%`}>
        <div className="wdl-seg wdl-user" style={{ width: `${u}%` }} />
        <div className="wdl-seg wdl-draw" style={{ width: `${d}%` }} />
        <div className="wdl-seg wdl-bot" style={{ width: `${b}%` }} />
      </div>
      <div className="wdl-legend">
        <span>🫵 {userLabel} {Math.round(u0)}%</span>
        <span>½ Draw {Math.round(d0)}%</span>
        <span>🤖 {botLabel} {Math.round(b0)}%</span>
      </div>
    </div>
  );
}
