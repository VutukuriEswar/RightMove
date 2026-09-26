import React, { useEffect, useState } from 'react';
import { coachApi } from '../../lib/api';

const ORDER = [
  'material', 'piece_placement', 'mobility', 'center_control', 'king_safety',
  'pawn_structure', 'tactical_defense', 'bishop_pair', 'rook_open_files',
  'space_advantage', 'knight_outposts',
];

function fmtDiff(d) {
  if (!Number.isFinite(d)) return '+0';
  return `${d > 0 ? '+' : ''}${Math.round(d)}`;
}

export default function ParametersPanel({ fen, playerColor = 'white', onProbs }) {
  const [params, setParams] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!fen || typeof fen !== 'string') return;
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const data = await coachApi.position(fen);
        if (cancelled || data?.error) return;
        setParams(data.parameters || null);
        setMeta({ net: data.net_score_centipawns, phase: data.game_phase, verdict: data.verdict });
        if (onProbs && data.win_probabilities) onProbs(data.win_probabilities);
      } catch (_) {
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [fen]);

  const youAreWhite = playerColor !== 'black';

  return (
    <div className="params-panel card">
      <button
        type="button"
        className={`params-toggle interactive ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>📊 Parameters {busy ? '…' : ''}</span>
        <span className="params-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {meta && (
        <p className="coach-text">
          <strong>{(meta.net / 100).toFixed(2)}</strong>
          {meta.phase ? ` · ${meta.phase}` : ''}
        </p>
      )}
      {open && (
        <>
          {!params && <p className="coach-text">Analyzing position…</p>}
          {params && (
            <div className="params-table-wrap">
              <table className="params-table">
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>You</th>
                    <th>Bot</th>
                    <th>+/−</th>
                  </tr>
                </thead>
                <tbody>
                  {ORDER.filter((k) => params[k]).map((k) => {
                    const p = params[k];
                    const you = youAreWhite ? p.white : p.black;
                    const bot = youAreWhite ? p.black : p.white;
                    const diffYou = youAreWhite ? p.diff : -p.diff;
                    return (
                      <tr key={k} className="param-row">
                        <td className="param-name" title={p.description}>{p.name}</td>
                        <td className="param-val">{Math.round(you)}</td>
                        <td className="param-val">{Math.round(bot)}</td>
                        <td className={`param-diff ${diffYou > 0 ? 'pw' : diffYou < 0 ? 'pb' : ''}`}>
                          {fmtDiff(diffYou)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
