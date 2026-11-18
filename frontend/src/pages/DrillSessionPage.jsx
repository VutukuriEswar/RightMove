import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useDrillSession } from '../hooks/useDrillSession';
import { useCurriculumStore } from '../store/curriculumStore';
import DrillBoard from '../components/curriculum/DrillBoard';

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
    onNextPosition,
    onEndSession,
  } = useDrillSession(clusterFilter);

  const fetchSessionDebrief = useCurriculumStore((s) => s.fetchSessionDebrief);
  const [debrief, setDebrief] = useState(null);
  const [debriefLoading, setDebriefLoading] = useState(false);

  useEffect(() => {
    if (!isCompleted || answers.length === 0) return;
    let cancelled = false;
    setDebriefLoading(true);

    fetchSessionDebrief(clusterFilter, answers)
      .then((data) => {
        if (!cancelled && data) {
          setDebrief(data);
        }
      })
      .finally(() => {
        if (!cancelled) setDebriefLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isCompleted, answers, clusterFilter, fetchSessionDebrief]);

  if (queueLoading) {
    return (
      <div
        style={{
          minHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--royal-gold, #D4AF37)',
          gap: 16,
        }}
      >
        <div style={{ fontSize: '2.5rem' }}>♟</div>
        <p style={{ color: 'var(--text-dim, #64748b)', fontSize: '1.05rem', fontWeight: 600 }}>
          Assembling targeted drill positions…
        </p>
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
          className="curriculum-card"
          style={{
            maxWidth: 480,
            padding: '40px 32px',
            textAlign: 'center',
          }}
        >
          <span style={{ fontSize: '3rem', display: 'block', marginBottom: 12 }}>🎉</span>
          <h2 style={{ color: 'var(--royal-ink, #1C1008)', fontSize: '1.5rem', marginBottom: 8 }}>
            All caught up!
          </h2>
          <p style={{ color: 'var(--text-dim, #64748b)', fontSize: '0.95rem', lineHeight: 1.5, marginBottom: 24 }}>
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
    const accuracyPct = Math.round((totalCorrect / Math.max(1, totalAttempted)) * 100);

    return (
      <div
        style={{
          minHeight: '80vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="curriculum-card"
          style={{
            maxWidth: 680,
            width: '100%',
            padding: '36px 32px',
          }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <span style={{ fontSize: '3.2rem', display: 'block', marginBottom: 12 }}>
              {accuracyPct >= 80 ? '🏆' : accuracyPct >= 50 ? '🎯' : '♟️'}
            </span>
            <h2 style={{ color: 'var(--royal-ink, #1C1008)', fontSize: '1.75rem', margin: '0 0 6px 0', fontWeight: 800 }}>
              Session Complete!
            </h2>
            <p style={{ color: 'var(--text-dim, #64748b)', fontSize: '1rem', margin: 0 }}>
              You solved <strong style={{ color: '#10b981' }}>{totalCorrect}</strong> out of{' '}
              <strong>{totalAttempted}</strong> positions ({accuracyPct}% accuracy).
            </p>
          </div>

          {/* Issue Health Status Badge */}
          <div
            style={{
              background: 'var(--surface-1, rgba(0, 0, 0, 0.06))',
              border: '1px solid var(--surface-line, rgba(212, 175, 55, 0.25))',
              borderRadius: 14,
              padding: '16px 20px',
              marginBottom: 24,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-dim, #64748b)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Weakness Profile Updated
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--royal-ink, #1C1008)', marginTop: 2 }}>
                {debrief?.cluster_name || clusterFilter || 'Active Weaknesses'}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span
                style={{
                  display: 'inline-block',
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  padding: '4px 12px',
                  borderRadius: 999,
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                {debrief?.stage_after || 'Improving'} · {debrief?.health_after ? `${Math.round(debrief.health_after)}%` : 'Active'}
              </span>
              <div style={{ fontSize: '0.75rem', color: 'var(--royal-crimson, #8B2500)', marginTop: 4, fontWeight: 600 }}>
                ⚡ Progress synced to profile
              </div>
            </div>
          </div>

          {/* AI Coach Style & Root Cause Debrief */}
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.08), rgba(0, 0, 0, 0.03))',
              border: '1.5px solid var(--royal-border, rgba(212, 175, 55, 0.35))',
              borderRadius: 14,
              padding: '20px',
              marginBottom: 28,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--surface-line, rgba(212, 175, 55, 0.2))', paddingBottom: 10 }}>
              <span style={{ fontSize: '1.25rem' }}>🧠</span>
              <span style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--royal-crimson, #8B2500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                AI Coach Style & Playing Habit Debrief
              </span>
            </div>

            {debriefLoading ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-dim, #64748b)' }}>
                Analyzing your tactical instincts and playing style…
              </div>
            ) : debrief ? (
              <>
                {/* Style Diagnosis */}
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dim, #64748b)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    Why You Make This Mistake (Playing Style Habit)
                  </div>
                  <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--royal-ink, #1C1008)', lineHeight: 1.55 }}>
                    {debrief.style_diagnosis}
                  </p>
                </div>

                {/* What to do instead */}
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dim, #64748b)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    What You Should Do Instead Over The Board
                  </div>
                  <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--royal-ink, #1C1008)', lineHeight: 1.55 }}>
                    {debrief.what_to_do_instead}
                  </p>
                </div>

                {/* Action Plan */}
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dim, #64748b)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                    Action Plan to Overcome This Blind Spot
                  </div>
                  <div style={{ whiteSpace: 'pre-line', fontSize: '0.9rem', color: 'var(--text-body, #2D1B00)', lineHeight: 1.55, background: 'var(--surface-1, rgba(0,0,0,0.04))', padding: '12px 16px', borderRadius: 8 }}>
                    {debrief.action_plan_to_overcome}
                  </div>
                </div>

                {/* Coach Takeaway */}
                {debrief.coach_takeaway && (
                  <div
                    style={{
                      background: 'rgba(212, 175, 55, 0.15)',
                      borderLeft: '4px solid var(--royal-gold, #D4AF37)',
                      padding: '10px 14px',
                      borderRadius: 6,
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      color: 'var(--royal-ink, #1C1008)',
                      fontStyle: 'italic',
                    }}
                  >
                    🏆 &ldquo;{debrief.coach_takeaway}&rdquo;
                  </div>
                )}
              </>
            ) : (
              <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--royal-ink, #1C1008)' }}>
                Keep drilling these positions regularly to build automatic tactical instincts under pressure.
              </p>
            )}
          </div>

          {/* Navigation Actions */}
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary interactive"
              onClick={() => navigate('/learn')}
              style={{ padding: '12px 24px', fontSize: '0.92rem' }}
            >
              ← Back to My Weaknesses
            </button>
            <button
              type="button"
              className="btn-neon interactive"
              onClick={() => navigate('/lobby')}
              style={{ padding: '12px 24px', fontSize: '0.92rem' }}
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
    <div className="drill-page-container">
      {/* Navigation Top Bar */}
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
            color: 'var(--text-dim, #64748b)',
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
            color: 'var(--text-dim, #64748b)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            textDecoration: 'underline',
          }}
        >
          End Session
        </button>
      </div>

      {/* Progress & Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <h2 style={{ color: 'var(--royal-ink, #1C1008)', fontSize: '1.25rem', margin: 0, fontWeight: 700 }}>
          Drill Session — {positionTitle}
        </h2>
        <span style={{ color: 'var(--text-dim, #64748b)', fontSize: '0.9rem', fontWeight: 600 }}>
          Position {currentIndex + 1} of {positions.length}
        </span>
      </div>

      {/* Progress Bar */}
      <div
        style={{
          width: '100%',
          height: 6,
          backgroundColor: 'var(--surface-line, rgba(0, 0, 0, 0.1))',
          borderRadius: 999,
          overflow: 'hidden',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progressPct}%`,
            backgroundColor: 'var(--royal-gold, #D4AF37)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* Interactive Chessboard */}
      <DrillBoard
        fen={currentPos?.fen}
        onMove={onPlayerMove}
        disabled={attemptState !== null}
        attemptState={attemptState}
        timeTaken={timeTaken}
      />

      {/* Move Evaluation & Feedback */}
      <div style={{ marginTop: 20 }}>
        <AnimatePresence mode="wait">
          {attemptState?.isCorrect && (
            <motion.div
              key="correct"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1.5px solid rgba(16, 185, 129, 0.45)',
                borderRadius: 14,
                padding: '18px 22px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <div>
                <div style={{ color: '#10b981', fontWeight: 800, fontSize: '1.1rem', marginBottom: 4 }}>
                  ✓ Brilliant! {attemptState.isAlternative ? '(Strong alternative)' : 'Best move found.'}
                </div>
                <div style={{ color: 'var(--royal-ink, #1C1008)', fontSize: '0.95rem', lineHeight: 1.5 }}>
                  <strong>{attemptState.movePlayed}</strong> — {attemptState.explanation || 'Optimal tactical execution.'}
                </div>
              </div>
              <button
                type="button"
                className="btn-neon interactive"
                onClick={onNextPosition}
                style={{ padding: '10px 22px', flexShrink: 0 }}
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
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1.5px solid rgba(239, 68, 68, 0.35)',
                borderRadius: 14,
                padding: '20px',
              }}
            >
              <div style={{ color: '#ef4444', fontWeight: 800, fontSize: '1.15rem', marginBottom: 12 }}>
                ✗ The best move was {attemptState.bestMove}.
              </div>

              {/* AI Coach Move Breakdown */}
              <div
                style={{
                  background: 'var(--surface-card, rgba(0, 0, 0, 0.04))',
                  border: '1px solid var(--surface-line, rgba(212, 175, 55, 0.25))',
                  borderRadius: 12,
                  padding: '16px',
                  marginBottom: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                {/* Why best */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: '1.25rem', marginTop: 1 }}>🟢</span>
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Why {attemptState.bestMove} is the best move
                    </div>
                    <div style={{ fontSize: '0.92rem', color: 'var(--royal-ink, #1C1008)', marginTop: 2, lineHeight: 1.5 }}>
                      {attemptState.whyBest || attemptState.explanation || 'Coordinates your pieces for maximum pressure.'}
                    </div>
                  </div>
                </div>

                {/* Why played move was a mistake */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: '1.25rem', marginTop: 1 }}>🔴</span>
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Why your move ({attemptState.movePlayed}) isn't
                    </div>
                    <div style={{ fontSize: '0.92rem', color: 'var(--royal-ink, #1C1008)', marginTop: 2, lineHeight: 1.5 }}>
                      {attemptState.whyPlayedFailed || 'Surrenders the tactical initiative and leaves open defensive liabilities.'}
                    </div>
                  </div>
                </div>

                {/* Takeaway rule */}
                {attemptState.takeaway && (
                  <div
                    style={{
                      background: 'rgba(212, 175, 55, 0.12)',
                      borderLeft: '3px solid var(--royal-gold, #D4AF37)',
                      borderRadius: 6,
                      padding: '8px 12px',
                      fontSize: '0.88rem',
                      color: 'var(--royal-ink, #1C1008)',
                      fontStyle: 'italic',
                    }}
                  >
                    💡 <strong>Coach Takeaway:</strong> {attemptState.takeaway}
                  </div>
                )}
              </div>

              {/* Next Position Button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                <button
                  type="button"
                  className="btn-neon interactive"
                  onClick={onNextPosition}
                  style={{ padding: '10px 22px' }}
                >
                  Next Position →
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
