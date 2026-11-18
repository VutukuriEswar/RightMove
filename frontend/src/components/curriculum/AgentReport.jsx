import React from 'react';
import { Chess } from 'chess.js';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import SignalBadge from './SignalBadge';
import Board2D from '../board/Board2D';

function getBoardOrientation(fenStr) {
  try {
    const c = new Chess(fenStr);
    return c.turn() === 'b' ? 'black' : 'white';
  } catch (_) {
    return 'white';
  }
}

export default function AgentReport({ report, cluster, onDismiss, onDrillNow }) {
  const navigate = useNavigate();
  if (!report) return null;

  const dateStr = report.generated_at
    ? new Date(report.generated_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Recent';

  const title = cluster?.display_name || report.pattern_name || 'Weakness Analysis';
  const positions = report.representative_positions || cluster?.representative_fens || [];

  const handleStartDrill = () => {
    if (onDrillNow) {
      onDrillNow();
    } else {
      navigate(`/learn/drill?cluster=${encodeURIComponent(report.cluster_id || cluster?.cluster_id)}`);
    }
  };

  return (
    <motion.div
      className="curriculum-report-panel"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      style={{ overflow: 'hidden' }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--surface-line, rgba(212, 175, 55, 0.2))',
          paddingBottom: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              color: 'var(--royal-crimson, #8B2500)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            AI Coach Diagnostic Report
          </span>
          <h3
            style={{
              fontSize: '1.35rem',
              fontWeight: 700,
              color: 'var(--royal-ink, #1C1008)',
              margin: '4px 0 0 0',
            }}
          >
            {title}
          </h3>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim, #64748b)' }}>
            Generated {dateStr}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* What is happening */}
        <div>
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              color: 'var(--text-dim, #64748b)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            What is happening
          </div>
          <p
            style={{
              fontSize: '1.05rem',
              color: 'var(--royal-ink, #1C1008)',
              lineHeight: 1.55,
              margin: 0,
              fontWeight: 500,
            }}
          >
            {report.pattern_name}
          </p>
        </div>

        {/* Why it keeps happening */}
        <div>
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              color: 'var(--text-dim, #64748b)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Why it keeps happening
          </div>
          <p
            style={{
              fontSize: '0.95rem',
              color: 'var(--text-body, #2D1B00)',
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {report.root_cause}
          </p>
        </div>

        <SignalBadge
          signals={report.signals}
          title={`Ask yourself before moving in ${title.toLowerCase()}`}
        />

        {/* How to practice */}
        <div>
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              color: 'var(--text-dim, #64748b)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            How to practice this
          </div>
          <p
            style={{
              fontSize: '0.95rem',
              color: 'var(--text-body, #2D1B00)',
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {report.drill_guidance}
          </p>
        </div>

        {/* Representative positions — large boards */}
        {positions.length > 0 && (
          <div>
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'var(--text-dim, #64748b)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 12,
              }}
            >
              Representative Mistake Positions
            </div>
            <div className="curriculum-rep-grid">
              {positions.slice(0, 3).map((fenStr, idx) => (
                <div key={idx} className="curriculum-rep-board-card">
                  <div style={{ width: '100%', maxWidth: 320, pointerEvents: 'none' }}>
                    <Board2D
                      id={`reportBoard-${report._id || 'rep'}-${idx}`}
                      fen={fenStr}
                      disabled
                      playerColor={getBoardOrientation(fenStr)}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-dim, #64748b)',
                      marginTop: 10,
                      fontFamily: 'monospace',
                      fontWeight: 600,
                    }}
                  >
                    Position #{idx + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 24,
          paddingTop: 16,
          borderTop: '1px solid var(--surface-line, rgba(212, 175, 55, 0.2))',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: '1px solid var(--royal-border, rgba(212, 175, 55, 0.4))',
            color: 'var(--text-dim, #64748b)',
            borderRadius: 8,
            padding: '8px 16px',
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          {report.acknowledged_by_user ? 'Close' : 'Dismiss / Acknowledge'}
        </button>

        <button
          type="button"
          className="btn-neon interactive"
          onClick={handleStartDrill}
          style={{
            padding: '10px 24px',
            fontSize: '0.95rem',
          }}
        >
          START DRILLING →
        </button>
      </div>
    </motion.div>
  );
}
