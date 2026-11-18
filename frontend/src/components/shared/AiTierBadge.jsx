import React from 'react';

const TIER_MAP = {
  T1: { tier: 'T1', cls: 't1', title: 'Tier 1: Cloud AI (OpenRouter)' },
  T2: { tier: 'T2', cls: 't2', title: 'Tier 2: Remote GPU (Kaggle)' },
  T3: { tier: 'T3', cls: 't3', title: 'Tier 3: Local CPU (Ollama)' },
  T4: { tier: 'T4', cls: 't4', title: 'Tier 4: Grandmaster Heuristics' },
};

export function resolveTier(tierOrSource) {
  const s = String(tierOrSource || '').toUpperCase();
  if (s.includes('T1') || s.includes('OPENROUTER')) return TIER_MAP.T1;
  if (s.includes('T2') || s.includes('KAGGLE')) return TIER_MAP.T2;
  if (s.includes('T3') || s.includes('LOCAL') || s.includes('OLLAMA')) return TIER_MAP.T3;
  return TIER_MAP.T4;
}

export default function AiTierBadge({ source, tier, pending, style }) {
  const meta = resolveTier(tier || source);
  const isPending = pending && meta.tier === 'T4';
  const title = isPending ? 'Tier 4: Grandmaster Heuristics (Local T3 refining...)' : meta.title;
  return (
    <span className={`ai-tier-tag ${meta.cls}${isPending ? ' pending-upgrade' : ''}`} title={title} style={style}>
      <span className="ai-tier-dot" />
      {meta.tier}
      {isPending && <span style={{ fontSize: '0.55rem', opacity: 0.85, marginLeft: 2 }}>⏳</span>}
    </span>
  );
}
