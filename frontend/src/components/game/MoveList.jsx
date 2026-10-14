import React, { memo, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CLASSIFICATION_META, normalizeClassification } from '../../lib/chessUtils';

const MoveList = memo(function MoveList({ moves, activeIndex = null, onMoveClick }) {
  const bodyRef = useRef(null);
  const bottomRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    if (!bodyRef.current) return;
    if (activeIndex === null) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      return;
    }
    if (activeRef.current && activeRef.current.scrollIntoView) {
      try {
        activeRef.current.scrollIntoView({ block: 'nearest' });
      } catch (_) {
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      }
    }
  }, [moves.length, activeIndex]);

  const pairs = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push([moves[i], moves[i + 1] || null]);
  }

  return (
    <div className="move-list" role="log" aria-label="Move history" aria-live="polite">
      <div className="move-list-header">
        <span className="move-list-col-num">#</span>
        <span className="move-list-col">White</span>
        <span className="move-list-col">Black</span>
      </div>
      <div className="move-list-body" ref={bodyRef}>
        {pairs.map((pair, pairIdx) => {
          const whiteMove = pair[0];
          const blackMove = pair[1];
          const whiteMoveIdx = pairIdx * 2;
          const blackMoveIdx = pairIdx * 2 + 1;

          return (
            <motion.div
              key={pairIdx}
              ref={activeIndex === whiteMoveIdx || activeIndex === blackMoveIdx ? activeRef : undefined}
              className="move-pair"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
            >
              <span className="move-num mono">{pairIdx + 1}.</span>
              <MoveCell
                move={whiteMove}
                isActive={activeIndex === whiteMoveIdx}
                onClick={() => onMoveClick?.(whiteMoveIdx)}
              />
              <MoveCell
                move={blackMove}
                isActive={activeIndex === blackMoveIdx}
                onClick={() => blackMove && onMoveClick?.(blackMoveIdx)}
              />
            </motion.div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});

function MoveCell({ move, isActive, onClick }) {
  if (!move) return <span className="move-cell empty" />;
  const key = normalizeClassification(move.classification);
  const meta = CLASSIFICATION_META[key];

  return (
    <button
      className={`move-cell ${isActive ? 'move-cell-active' : ''}`}
      onClick={onClick}
      title={meta ? meta.label : undefined}
      aria-current={isActive ? 'step' : undefined}
    >
      <span className="move-san mono">{move.san}</span>
      {meta && (
        <span
          className="move-annotation"
          style={{ color: meta.color }}
          aria-hidden="true"
        >
          {meta.emoji}
        </span>
      )}
    </button>
  );
}

export default MoveList;
