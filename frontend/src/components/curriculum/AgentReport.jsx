import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import SignalBadge from './SignalBadge';
import Board2D from '../board/Board2D';

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
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      style={{
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        borderRadius: 16,
        padding: '24px',
        marginTop: 16,
        overflow: 'hidden',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          paddingBottom: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              color: '#38bdf8',
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
              color: '#fff',
              margin: '4px 0 0 0',
            }}
          >
            {title}
          </h3>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Generated {dateStr}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <div
            style={{
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#94a3b8',
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
              color: '#f8fafc',
              lineHeight: 1.55,
              margin: 0,
              fontWeight: 500,
            }}
          >
            {report.pattern_name}
          </p>
        </div>

        <div>
          <div
            style={{
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#94a3b8',
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
              color: '#cbd5e1',
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

        <div>
          <div
            style={{
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#94a3b8',
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
              color: '#cbd5e1',
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {report.drill_guidance}
          </p>
        </div>

        {positions.length > 0 && (
          <div>
            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: '#94a3b8',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 12,
              }}
            >
              Representative Mistake Positions
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 16,
              }}
            >
              {positions.slice(0, 3).map((fenStr, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'rgba(0, 0, 0, 0.35)',
                    borderRadius: 10,
                    padding: 10,
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ width: '100%', maxWidth: 170, pointerEvents: 'none' }}>
                    <Board2D
                      id={`reportBoard-${report._id || 'rep'}-${idx}`}
                      fen={fenStr}
                      disabled
                      playerColor="white"
                    />
                  </div>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: '#94a3b8',
                      marginTop: 8,
                      fontFamily: 'monospace',
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

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 24,
          paddingTop: 16,
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#94a3b8',
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
          Start Drilling →
        </button>
      </div>
    </motion.div>
  );
}
