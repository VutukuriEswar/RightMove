import React, { memo, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CLASSIFICATION_META, normalizeClassification } from '../../lib/chessUtils';

function capitalize(s) {
  if (!s || typeof s !== 'string') return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatEval(cp) {
  if (cp == null || Number.isNaN(Number(cp))) return null;
  const num = Number(cp);
  return num >= 0 ? `+${(num / 100).toFixed(1)}` : `${(num / 100).toFixed(1)}`;
}

const MoveList = memo(function MoveList({ moves, activeIndex = null, onMoveClick }) {
  const bodyRef = useRef(null);
  const bottomRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    if (!bodyRef.current) return;
    if (activeIndex === null || activeIndex < 0) {
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

          const isWhiteActive = activeIndex === whiteMoveIdx;
          const isBlackActive = activeIndex === blackMoveIdx;
          const isPairActive = isWhiteActive || isBlackActive;

          const activeSubMove = isWhiteActive
            ? (['inaccuracy', 'mistake', 'blunder'].includes(whiteMove?.classification) ? whiteMove : null)
            : isBlackActive
            ? (['inaccuracy', 'mistake', 'blunder'].includes(blackMove?.classification) ? blackMove : null)
            : null;

          return (
            <React.Fragment key={pairIdx}>
              <motion.div
                ref={isPairActive ? activeRef : undefined}
                className={`move-pair ${isPairActive ? 'move-pair-focused' : ''}`}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15 }}
              >
                <span className="move-num mono">{pairIdx + 1}.</span>
                <MoveCell
                  move={whiteMove}
                  isActive={isWhiteActive}
                  onClick={() => onMoveClick?.(whiteMoveIdx)}
                />
                <MoveCell
                  move={blackMove}
                  isActive={isBlackActive}
                  onClick={() => blackMove && onMoveClick?.(blackMoveIdx)}
                />
              </motion.div>

              {activeSubMove && (
                <div className={`move-alert-row ${activeSubMove.classification}`}>
                  <div className="move-alert-text">
                    <span className="move-alert-icon">💡</span>
                    <strong>{capitalize(activeSubMove.classification)}.</strong>{' '}
                    <span>{activeSubMove.best_move_san || 'Alternative'} was best.</span>
                  </div>
                  {activeSubMove.comment && (
                    <div className="move-alert-pv mono">{activeSubMove.comment}</div>
                  )}
                </div>
              )}
            </React.Fragment>
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
  const evalStr = formatEval(move.eval_after_cp);

  return (
    <button
      className={`move-cell ${isActive ? 'move-cell-active' : ''} ${key ? `cell-${key}` : ''}`}
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
      {evalStr && (
        <span className="move-eval-score mono">{evalStr}</span>
      )}
    </button>
  );
}

export default MoveList;
