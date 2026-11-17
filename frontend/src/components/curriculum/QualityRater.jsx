import React, { useState } from 'react';
import { motion } from 'framer-motion';

const OPTIONS = [
  { score: 1, label: 'Still confused', icon: '❓', desc: 'Need more practice' },
  { score: 2, label: 'Saw it after', icon: '💡', desc: 'Makes sense now' },
  { score: 3, label: 'Close alternative', icon: '🎯', desc: 'Right piece, wrong square' },
  { score: 4, label: 'Understood well', icon: '👍', desc: 'Will find next time' },
  { score: 5, label: 'Clear now', icon: '⭐', desc: 'Fully grasped' },
];

export default function QualityRater({ onSubmit, submitting = false }) {
  const [selectedScore, setSelectedScore] = useState(2);

  return (
    <div
      style={{
        background: 'rgba(30, 41, 59, 0.7)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 12,
        padding: '16px 20px',
        margin: '14px 0',
      }}
    >
      <div
        style={{
          fontSize: '0.95rem',
          fontWeight: 600,
          color: '#f8fafc',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>How well did you understand this move?</span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
          gap: 8,
          marginBottom: 16,
        }}
      >
        {OPTIONS.map((opt) => {
          const isSelected = selectedScore === opt.score;
          return (
            <motion.button
              key={opt.score}
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setSelectedScore(opt.score)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '10px 8px',
                borderRadius: 8,
                border: isSelected
                  ? '1px solid #38bdf8'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                background: isSelected
                  ? 'rgba(56, 189, 248, 0.18)'
                  : 'rgba(255, 255, 255, 0.03)',
                color: isSelected ? '#38bdf8' : '#cbd5e1',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>{opt.icon}</span>
              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{opt.score} · {opt.label}</span>
            </motion.button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn-neon interactive"
          onClick={() => onSubmit(selectedScore)}
          disabled={submitting}
          style={{
            minWidth: 160,
            padding: '10px 20px',
          }}
        >
          {submitting ? 'Recording…' : 'Submit & Continue →'}
        </button>
      </div>
    </div>
  );
}
