import React from 'react';
import { motion } from 'framer-motion';

export default function DrillQueue({ queue = [], onSelectPosition }) {
  if (!queue || queue.length === 0) {
    return (
      <div
        style={{
          padding: '24px',
          textAlign: 'center',
          background: 'rgba(15, 23, 42, 0.4)',
          borderRadius: 12,
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          color: '#94a3b8',
        }}
      >
        <span>No drill positions overdue right now. Great job keeping your memory fresh!</span>
      </div>
    );
  }

  const formatDue = (nextReviewAt) => {
    if (!nextReviewAt) return 'Due now';
    const due = new Date(nextReviewAt);
    const now = new Date();
    const diffHours = Math.round((due - now) / (1000 * 60 * 60));
    if (diffHours <= 0) return 'Overdue';
    if (diffHours < 24) return `Due in ${diffHours}h`;
    const diffDays = Math.round(diffHours / 24);
    return `Due in ${diffDays}d`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {queue.map((pos, idx) => {
        const dueText = formatDue(pos.next_review_at);
        const isOverdue = dueText === 'Overdue';

        return (
          <motion.div
            key={pos._id || pos.id || idx}
            whileHover={{ scale: 1.01 }}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              background: 'rgba(15, 23, 42, 0.65)',
              border: isOverdue
                ? '1px solid rgba(244, 63, 94, 0.35)'
                : '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 10,
              cursor: onSelectPosition ? 'pointer' : 'default',
            }}
            onClick={() => onSelectPosition && onSelectPosition(pos)}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.95rem' }}>
                  {pos.display_name || 'Chess Drill'}
                </span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: isOverdue ? 'rgba(244, 63, 94, 0.2)' : 'rgba(56, 189, 248, 0.15)',
                    color: isOverdue ? '#f43f5e' : '#38bdf8',
                    fontWeight: 700,
                  }}
                >
                  {dueText}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 4 }}>
                Interval: {pos.interval_days || 1}d · Repetitions: {pos.repetition_count || 0}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.85rem', color: '#38bdf8', fontWeight: 600 }}>
                Practice →
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
