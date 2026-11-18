import React from 'react';
import { motion } from 'framer-motion';

export default function SignalBadge({ signals = [], title = 'Ask yourself before making this move' }) {
  if (!signals || signals.length === 0) return null;

  return (
    <div
      style={{
        background: 'var(--surface-1, rgba(0, 0, 0, 0.06))',
        border: '1px solid var(--royal-border, rgba(212, 175, 55, 0.3))',
        borderRadius: 12,
        padding: '16px 20px',
        margin: '12px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          color: 'var(--royal-crimson, #8B2500)',
          fontWeight: 600,
          fontSize: '0.9rem',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ fontSize: '1.1rem' }}>💡</span>
        <span>{title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {signals.map((sig, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.08 }}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              background: 'var(--surface-card, rgba(0, 0, 0, 0.04))',
              padding: '10px 14px',
              borderRadius: 8,
              borderLeft: '3px solid var(--royal-gold, #D4AF37)',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: 'rgba(212, 175, 55, 0.18)',
                color: 'var(--royal-gold, #D4AF37)',
                fontWeight: 700,
                fontSize: '0.8rem',
                flexShrink: 0,
              }}
            >
              {idx + 1}
            </span>
            <span
              style={{
                color: 'var(--royal-ink, #1C1008)',
                fontSize: '0.95rem',
                lineHeight: 1.45,
              }}
            >
              {sig}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
