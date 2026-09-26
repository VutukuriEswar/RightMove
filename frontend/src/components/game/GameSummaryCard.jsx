import React from 'react';
import { motion } from 'framer-motion';

export default function GameSummaryCard({ summary, whiteUsername, blackUsername }) {
  if (!summary) return null;

  const { accuracy_white, accuracy_black, summary_text, key_moments = [] } = summary;

  return (
    <motion.div
      className="summary-card card"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <h3 className="summary-title">Game Summary</h3>

      <div className="accuracy-row">
        <AccuracyBlock label={whiteUsername || 'White'} accuracy={accuracy_white} color="var(--color-card)" />
        <span className="accuracy-vs">vs</span>
        <AccuracyBlock label={blackUsername || 'Black'} accuracy={accuracy_black} color="var(--color-ink-dark)" />
      </div>

      {summary_text && (
        <div
          className="summary-text"
          dangerouslySetInnerHTML={{ __html: summary_text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}
        />
      )}

      {key_moments.length > 0 && (
        <div className="key-moments">
          <h4 className="key-moments-title">Key Turning Points</h4>
          {key_moments.map((km, i) => (
            <div key={i} className="key-moment">
              <span className={`badge badge-${km.classification}`}>
                {km.classification}
              </span>
              <span className="key-moment-move mono">{km.san}</span>
              <span className="key-moment-delta">
                {km.delta_win_prob > 0 ? '−' : '+'}{Math.round(Math.abs(km.delta_win_prob) * 100)}% win chance
              </span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function AccuracyBlock({ label, accuracy, color }) {
  const pct = accuracy ?? 0;
  const grade =
    pct >= 95 ? 'Brilliant' :
    pct >= 85 ? 'Great' :
    pct >= 70 ? 'Good' :
    pct >= 55 ? 'Inaccurate' : 'Blundered';

  return (
    <div className="accuracy-block">
      <div className="accuracy-avatar" style={{ background: color }}>
        {label[0]?.toUpperCase()}
      </div>
      <div className="accuracy-info">
        <span className="accuracy-username">{label}</span>
        <span className="accuracy-value mono">{pct.toFixed(1)}%</span>
        <span className="accuracy-grade">{grade}</span>
      </div>
      <div className="accuracy-bar-track">
        <div className="accuracy-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
