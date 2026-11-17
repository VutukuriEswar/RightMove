import React, { useState } from 'react';
import { motion } from 'framer-motion';

const CLUSTER_COLORS = [
  '#38bdf8',
  '#a855f7',
  '#f59e0b',
  '#10b981',
  '#f43f5e',
  '#ec4899',
];

export default function ImprovementChart({ clusters = [] }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);

  if (!clusters || clusters.length === 0) {
    return (
      <div
        style={{
          padding: '32px',
          textAlign: 'center',
          background: 'rgba(15, 23, 42, 0.5)',
          borderRadius: 16,
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          color: '#94a3b8',
        }}
      >
        <span>No progress history yet. Complete drill sessions to chart your mastery over time.</span>
      </div>
    );
  }

  const width = 640;
  const height = 260;
  const padding = { top: 20, right: 30, bottom: 40, left: 45 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const allDates = [];
  clusters.forEach((c) => {
    (c.health_history || []).forEach((h) => {
      if (h.date && !allDates.includes(h.date)) {
        allDates.push(h.date);
      }
    });
  });

  if (allDates.length === 0) {
    allDates.push('Start', 'Current');
  }

  const getX = (idx) => {
    if (allDates.length <= 1) return padding.left + chartW / 2;
    return padding.left + (idx / (allDates.length - 1)) * chartW;
  };

  const getY = (val) => {
    const clamped = Math.max(0, Math.min(100, val));
    return padding.top + chartH - (clamped / 100) * chartH;
  };

  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.8)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 16,
        padding: '20px',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h4 style={{ margin: 0, color: '#fff', fontSize: '1.1rem', fontWeight: 700 }}>
            Weakness Mastery Over Time
          </h4>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Tracking composite health (0% Active → 100% Resolved)
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {clusters.map((c, i) => (
            <div
              key={c.cluster_id || i}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
                }}
              />
              <span style={{ color: '#cbd5e1' }}>{c.display_name}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', height: 'auto', minWidth: 480 }}
        >
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = getY(tick);
            return (
              <g key={tick}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="rgba(255, 255, 255, 0.08)"
                  strokeDasharray="4 4"
                />
                <text
                  x={padding.left - 8}
                  y={y + 4}
                  fill="#64748b"
                  fontSize="10"
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  {tick}%
                </text>
              </g>
            );
          })}

          {allDates.map((d, idx) => {
            const x = getX(idx);
            return (
              <text
                key={idx}
                x={x}
                y={height - padding.bottom + 20}
                fill="#64748b"
                fontSize="11"
                textAnchor="middle"
              >
                {d}
              </text>
            );
          })}

          {clusters.map((c, cIdx) => {
            const color = CLUSTER_COLORS[cIdx % CLUSTER_COLORS.length];
            const history = c.health_history || [];

            const points = allDates.map((dateStr, dIdx) => {
              const match = history.find((h) => h.date === dateStr);
              const val = match ? match.health : c.health || 0;
              return { x: getX(dIdx), y: getY(val), val, date: dateStr, name: c.display_name };
            });

            if (points.length === 0) return null;

            const pathD = points.reduce((acc, pt, i) => {
              return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
            }, '');

            return (
              <g key={c.cluster_id || cIdx}>
                <motion.path
                  d={pathD}
                  fill="none"
                  stroke={color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />

                {points.map((pt, pIdx) => (
                  <circle
                    key={pIdx}
                    cx={pt.x}
                    cy={pt.y}
                    r={hoveredPoint && hoveredPoint.pt === pt ? 6 : 4}
                    fill={color}
                    stroke="#0f172a"
                    strokeWidth="2"
                    style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
                    onMouseEnter={() => setHoveredPoint({ pt, color })}
                    onMouseLeave={() => setHoveredPoint(null)}
                  />
                ))}
              </g>
            );
          })}

          {hoveredPoint && (
            <g>
              <rect
                x={Math.min(width - 130, Math.max(10, hoveredPoint.pt.x - 60))}
                y={Math.max(10, hoveredPoint.pt.y - 42)}
                width="120"
                height="32"
                rx="6"
                fill="#0f172a"
                stroke={hoveredPoint.color}
                strokeWidth="1.5"
              />
              <text
                x={Math.min(width - 130, Math.max(10, hoveredPoint.pt.x - 60)) + 60}
                y={Math.max(10, hoveredPoint.pt.y - 42) + 20}
                fill="#fff"
                fontSize="11"
                fontWeight="bold"
                textAnchor="middle"
              >
                {hoveredPoint.pt.name}: {hoveredPoint.pt.val}%
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
