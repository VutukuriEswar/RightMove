import React from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useDrillSession } from '../hooks/useDrillSession';
import DrillBoard from '../components/curriculum/DrillBoard';
import QualityRater from '../components/curriculum/QualityRater';
import SignalBadge from '../components/curriculum/SignalBadge';

export default function DrillSessionPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const clusterFilter = searchParams.get('cluster');

  const {
    positions,
    currentIndex,
    currentPos,
    isCompleted,
    answers,
    timeTaken,
    attemptState,
    submitting,
    queueLoading,
    onPlayerMove,
    onRatingSubmit,
    onNextPosition,
    onEndSession,
  } = useDrillSession(clusterFilter);

  if (queueLoading) {
    return (
      <div
        style={{
          minHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#38bdf8',
          gap: 16,
        }}
      >
        <div style={{ fontSize: '2rem' }}>♟</div>
        <p style={{ color: '#94a3b8', fontSize: '1rem' }}>Assembling targeted drill positions…</p>
      </div>
    );
  }

  if (positions.length === 0 && !queueLoading) {
    return (
      <div
        style={{
          minHeight: '75vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 20,
            padding: '40px 32px',
            maxWidth: 480,
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.4)',
          }}
        >
          <span style={{ fontSize: '3rem', display: 'block', marginBottom: 12 }}>🎉</span>
          <h2 style={{ color: '#fff', fontSize: '1.5rem', marginBottom: 8 }}>All caught up!</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: 1.5, marginBottom: 24 }}>
            There are no positions due for review right now. Play a game or analyze recent matches to
            continue sharpening your skills.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <Link to="/learn" className="btn-secondary interactive" style={{ padding: '10px 20px' }}>
              ← Learn Hub
            </Link>
            <Link to="/lobby" className="btn-neon interactive" style={{ padding: '10px 20px' }}>
              Play Game →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isCompleted) {
    const totalCorrect = answers.filter((a) => a.is_correct).length;
    const totalAttempted = answers.length;
    const clustersCovered = Array.from(new Set(answers.map((a) => a.cluster_id))).filter(Boolean);

    return (
      <div
        style={{
          minHeight: '80vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            background: 'rgba(15, 23, 42, 0.9)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: 20,
            padding: '40px',
            maxWidth: 540,
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
          }}
        >
          <span style={{ fontSize: '3.5rem', display: 'block', marginBottom: 16 }}>🎯</span>
          <h2 style={{ color: '#fff', fontSize: '1.8rem', margin: '0 0 8px 0' }}>Session Complete!</h2>
          <p style={{ color: '#94a3b8', fontSize: '1.1rem', marginBottom: 24 }}>
            You scored <strong style={{ color: '#10b981' }}>{totalCorrect}</strong> out of{' '}
            <strong>{totalAttempted}</strong> positions correct.
          </p>

          <div
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '16px',
              marginBottom: 28,
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
              <strong>Weakness focus:</strong> {clusterFilter || 'Active Weaknesses'}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              <strong>Next review schedule:</strong> Overdue positions will return in 1 day, while
              mastered positions advance up to 6+ days.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary interactive"
              onClick={() => navigate('/learn')}
              style={{ padding: '12px 24px' }}
            >
              Back to My Weaknesses
            </button>
            <button
              type="button"
              className="btn-neon interactive"
              onClick={() => navigate('/lobby')}
              style={{ padding: '12px 24px' }}
            >
              Play a Game →
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const progressPct = Math.round(((currentIndex) / Math.max(1, positions.length)) * 100);
  const positionTitle = currentPos?.display_name || 'Weakness Drill';

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 16px',
        minHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Link
          to="/learn"
          style={{
            color: '#94a3b8',
            textDecoration: 'none',
            fontSize: '0.9rem',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          ← Back to Learn
        </Link>
        <button
          type="button"
          onClick={onEndSession}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            fontSize: '0.85rem',
            textDecoration: 'underline',
          }}
        >
          End Session
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <h2 style={{ color: '#fff', fontSize: '1.25rem', margin: 0 }}>
          Drill Session — {positionTitle}
        </h2>
        <span style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 600 }}>
          Position {currentIndex + 1} of {positions.length}
        </span>
      </div>

      <div
        style={{
          width: '100%',
          height: 6,
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: 999,
          overflow: 'hidden',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progressPct}%`,
            backgroundColor: '#38bdf8',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      <DrillBoard
        fen={currentPos?.fen}
        onMove={onPlayerMove}
        disabled={attemptState !== null}
        attemptState={attemptState}
        timeTaken={timeTaken}
      />

      <div style={{ marginTop: 20 }}>
        <AnimatePresence mode="wait">
          {attemptState?.isCorrect && (
            <motion.div
              key="correct"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: 12,
                padding: '16px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <div>
                <div style={{ color: '#10b981', fontWeight: 700, fontSize: '1.05rem', marginBottom: 4 }}>
                  ✓ Correct! {attemptState.isAlternative ? '(Strong alternative)' : ''}
                </div>
                <div style={{ color: '#e2e8f0', fontSize: '0.95rem' }}>
                  {attemptState.movePlayed} {attemptState.explanation ? `— ${attemptState.explanation}` : 'is the strongest continuation.'}
                </div>
              </div>
              <button
                type="button"
                className="btn-neon interactive"
                onClick={onNextPosition}
                style={{ padding: '10px 20px', flexShrink: 0 }}
              >
                Next Position →
              </button>
            </motion.div>
          )}

          {attemptState && !attemptState.isCorrect && (
            <motion.div
              key="incorrect"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: 12,
                padding: '20px',
              }}
            >
              <div style={{ color: '#ef4444', fontWeight: 700, fontSize: '1.1rem', marginBottom: 6 }}>
                ✗ The best move was {attemptState.bestMove}.
              </div>

              {attemptState.signals && attemptState.signals.length > 0 && (
                <SignalBadge
                  signals={attemptState.signals}
                  title="Before moving in this position, ask yourself"
                />
              )}

              {attemptState.awaitingRating ? (
                <QualityRater onSubmit={onRatingSubmit} submitting={submitting} />
              ) : (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                  <button
                    type="button"
                    className="btn-neon interactive"
                    onClick={onNextPosition}
                    style={{ padding: '10px 20px' }}
                  >
                    Next Position →
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
