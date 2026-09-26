import React, { useEffect, useRef, memo } from 'react';
import { motion } from 'framer-motion';
import { formatClock } from '../../lib/chessUtils';

const Clock = memo(function Clock({ ms, active, onTimeout }) {
  const safMs = (typeof ms === 'number' && !isNaN(ms)) ? ms : 600000;
  const rafRef = useRef(null);
  const lastTickRef = useRef(null);
  const [remaining, setRemaining] = React.useState(safMs);

  useEffect(() => {
    const val = (typeof ms === 'number' && !isNaN(ms)) ? ms : 600000;
    setRemaining(val);
  }, [ms]);

  useEffect(() => {
    if (!active) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTickRef.current = null;
      return;
    }

    const tick = (timestamp) => {
      if (lastTickRef.current !== null) {
        const delta = timestamp - lastTickRef.current;
        setRemaining((prev) => {
          const next = Math.max(0, prev - delta);
          if (next === 0 && onTimeout) onTimeout();
          return next;
        });
      }
      lastTickRef.current = timestamp;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTickRef.current = null;
    };
  }, [active, onTimeout]);

  const isLow = remaining <= 10000;
  const displayStr = formatClock(remaining);

  return (
    <div
      className={`clock ${active ? 'clock-active' : ''} ${isLow ? 'clock-low' : ''}`}
      role="timer"
      aria-label={`${active ? 'Active' : 'Paused'} clock: ${displayStr}`}
    >
      <span className="clock-time mono">{displayStr}</span>
      {active && (
        <motion.span
          className="clock-tick-dot"
          animate={{ opacity: [1, 0.2, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        />
      )}
    </div>
  );
});

export default Clock;
