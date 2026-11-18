import { useState, useEffect, useRef, useCallback } from 'react';
import { useCurriculumStore } from '../store/curriculumStore';

export function useDrillSession(clusterIdFilter = null) {
  const session = useCurriculumStore((s) => s.session);
  const queueLoading = useCurriculumStore((s) => s.queueLoading);
  const fetchDrillQueue = useCurriculumStore((s) => s.fetchDrillQueue);
  const startSession = useCurriculumStore((s) => s.startSession);
  const submitCurrentDrill = useCurriculumStore((s) => s.submitCurrentDrill);
  const advancePosition = useCurriculumStore((s) => s.advancePosition);
  const finishSession = useCurriculumStore((s) => s.finishSession);

  const [timeTaken, setTimeTaken] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [attemptState, setAttemptState] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef(null);

  const currentPos = session.positions[session.currentIndex] || null;

  useEffect(() => {
    let cancelled = false;
    fetchDrillQueue(clusterIdFilter).then((data) => {
      if (cancelled) return;
      if (data && data.positions && data.positions.length > 0) {
        startSession(data.positions, data.session_id, clusterIdFilter);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clusterIdFilter, fetchDrillQueue, startSession]);

  useEffect(() => {
    if (!currentPos || session.isCompleted) {
      setTimerRunning(false);
      return;
    }
    setTimeTaken(0);
    setAttemptState(null);
    setTimerRunning(true);
  }, [session.currentIndex, currentPos, session.isCompleted]);

  useEffect(() => {
    if (!timerRunning) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setTimeTaken((t) => t + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerRunning]);

  const handleMove = useCallback(
    async (moveSan, moveUci = null) => {
      if (!currentPos || attemptState !== null || submitting) return;
      setTimerRunning(false);

      // Normalize a move string: strip check/capture/promotion annotation for loose compare
      const norm = (s) => String(s || '').trim().replace(/[+#!?]/g, '').toLowerCase();

      const targetBest = (currentPos.best_move || '').trim();
      const altMoves = (currentPos.alternative_moves || []).map((m) => norm(m));

      const playedSan = (moveSan || '').trim();
      const playedUci = (moveUci || '').trim();

      const isExact =
        norm(playedSan) === norm(targetBest) ||
        (playedUci && norm(playedUci) === norm(targetBest)) ||
        playedSan.toLowerCase() === targetBest.toLowerCase() ||
        (playedUci && playedUci.toLowerCase() === targetBest.toLowerCase());

      const isAlt =
        altMoves.includes(norm(playedSan)) ||
        (playedUci && altMoves.includes(norm(playedUci)));

      const isCorrect = isExact || isAlt;

      if (isCorrect) {
        setSubmitting(true);
        const autoQuality = isAlt ? 3 : timeTaken < 15 ? 5 : 4;
        try {
          const res = await submitCurrentDrill(
            currentPos._id || currentPos.id,
            playedSan || playedUci,
            timeTaken,
            autoQuality
          );
          setAttemptState({
            isCorrect: true,
            isAlternative: isAlt,
            bestMove: targetBest,
            movePlayed: playedSan || playedUci,
            explanation: res.explanation || currentPos.explanation,
            signals: res.signals || [],
            qualityScore: autoQuality,
            nextIntervalDays: res.next_interval_days,
          });
        } catch (_) {
          setAttemptState({
            isCorrect: true,
            isAlternative: isAlt,
            bestMove: targetBest,
            movePlayed: playedSan || playedUci,
            explanation: currentPos.explanation || 'Excellent tactical execution.',
            signals: [],
            qualityScore: autoQuality,
            nextIntervalDays: 1,
          });
        } finally {
          setSubmitting(false);
        }
      } else {
        setSubmitting(true);
        try {
          const res = await submitCurrentDrill(
            currentPos._id || currentPos.id,
            playedSan || playedUci,
            timeTaken,
            0
          );
          setAttemptState({
            isCorrect: false,
            isAlternative: false,
            bestMove: targetBest,
            movePlayed: playedSan || playedUci,
            explanation: res.explanation || currentPos.explanation,
            whyBest: res.why_best || `In this position, ${targetBest} is the most active tactical choice.`,
            whyPlayedFailed: res.why_played_failed || `${playedSan || playedUci} misses the critical tactical response.`,
            takeaway: res.takeaway || 'Scan opponent checks and forcing replies before choosing candidate moves.',
            signals: res.signals || [],
          });
        } catch (_) {
          setAttemptState({
            isCorrect: false,
            isAlternative: false,
            bestMove: targetBest,
            movePlayed: playedSan || playedUci,
            explanation: currentPos.explanation,
            whyBest: `In this position, ${targetBest} is the most active tactical choice.`,
            whyPlayedFailed: `${playedSan || playedUci} misses the critical tactical response.`,
            takeaway: 'Scan opponent checks and forcing replies before choosing candidate moves.',
            signals: currentPos.signals || [],
          });
        } finally {
          setSubmitting(false);
        }
      }
    },
    [currentPos, attemptState, submitting, timeTaken, submitCurrentDrill]
  );

  const handleNext = useCallback(() => {
    setAttemptState(null);
    advancePosition();
  }, [advancePosition]);

  return {
    positions: session.positions,
    currentIndex: session.currentIndex,
    currentPos,
    isCompleted: session.isCompleted,
    answers: session.answers,
    timeTaken,
    attemptState,
    submitting,
    queueLoading,
    onPlayerMove: handleMove,
    onNextPosition: handleNext,
    onEndSession: finishSession,
  };
}
