import React from 'react';
import { motion } from 'framer-motion';

export default function SignalBadge({ signals = [], title = 'Ask yourself before making this move' }) {
  if (!signals || signals.length === 0) return null;

  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.65)',
        border: '1px solid rgba(56, 189, 248, 0.25)',
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
          color: '#38bdf8',
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
            transition={{ delay: idx * 0.1 }}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              background: 'rgba(255, 255, 255, 0.03)',
              padding: '10px 14px',
              borderRadius: 8,
              borderLeft: '3px solid #38bdf8',
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
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                fontWeight: 700,
                fontSize: '0.8rem',
                flexShrink: 0,
              }}
            >
              {idx + 1}
            </span>
            <span
              style={{
                color: '#e2e8f0',
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
