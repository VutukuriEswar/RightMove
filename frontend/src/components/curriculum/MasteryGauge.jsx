import React from 'react';
import { motion } from 'framer-motion';

export default function MasteryGauge({ health = 0, size = 64, strokeWidth = 6 }) {
  const clamped = Math.max(0, Math.min(100, Math.round(health)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  const getColor = (val) => {
    if (val <= 30) return '#f43f5e';
    if (val <= 60) return '#f59e0b';
    if (val <= 80) return '#06b6d4';
    return '#10b981';
  };

  const ringColor = getColor(clamped);

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            fontSize: size * 0.28,
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1,
            fontFamily: 'monospace',
          }}
        >
          {clamped}%
        </span>
      </div>
    </div>
  );
}
