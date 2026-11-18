import { create } from 'zustand';
import { curriculumApi } from '../lib/api';

export const useCurriculumStore = create((set, get) => ({
  clusters: [],
  pendingDrills: 0,
  unreadReports: 0,
  profileLoading: false,
  error: null,
  activeReports: {},
  progressData: null,
  drillHistory: [],
  drillQueue: [],
  queueLoading: false,

  session: {
    sessionId: null,
    positions: [],
    currentIndex: 0,
    answers: [],
    isCompleted: false,
    startTime: null,
    elapsedSeconds: 0,
    activeClusterId: null,
  },

  fetchProfile: async () => {
    set({ profileLoading: true, error: null });
    try {
      const data = await curriculumApi.getProfile();
      set({
        clusters: data.clusters || [],
        pendingDrills: data.pending_drills || 0,
        unreadReports: data.unread_reports || 0,
        profileLoading: false,
      });
      return data;
    } catch (err) {
      set({ error: err.message, profileLoading: false });
      return null;
    }
  },

  fetchDrillQueue: async (clusterId = null) => {
    set({ queueLoading: true, error: null });
    try {
      const data = await curriculumApi.getDrills(clusterId);
      set({
        drillQueue: data.positions || [],
        queueLoading: false,
      });
      return data;
    } catch (err) {
      set({ error: err.message, queueLoading: false });
      return { positions: [], session_id: null };
    }
  },

  startSession: (positions, sessionId, activeClusterId = null) => {
    set({
      session: {
        sessionId,
        positions: positions || [],
        currentIndex: 0,
        answers: [],
        isCompleted: false,
        startTime: Date.now(),
        elapsedSeconds: 0,
        activeClusterId,
      },
    });
  },

  submitCurrentDrill: async (srsId, movePlayed, timeTakenSeconds, qualityScore = null) => {
    try {
      const res = await curriculumApi.submitDrill(srsId, movePlayed, timeTakenSeconds, qualityScore);
      const current = get().session;
      const currentPos = current.positions[current.currentIndex] || {};
      const answerEntry = {
        srs_record_id: srsId,
        cluster_id: currentPos.cluster_id,
        fen: currentPos.fen,
        move_played: movePlayed,
        best_move: res.best_move,
        is_correct: res.correct,
        time_taken_seconds: timeTakenSeconds,
        quality_score: qualityScore,
        new_interval_days: res.next_interval_days,
        explanation: res.explanation,
        why_best: res.why_best,
        why_played_failed: res.why_played_failed,
        takeaway: res.takeaway,
        signals: res.signals,
      };

      const updatedAnswers = [...current.answers, answerEntry];
      set({
        session: {
          ...current,
          answers: updatedAnswers,
        },
      });

      return res;
    } catch (err) {
      throw err;
    }
  },

  advancePosition: () => {
    const current = get().session;
    const nextIdx = current.currentIndex + 1;
    if (nextIdx >= current.positions.length) {
      set({
        session: {
          ...current,
          currentIndex: nextIdx,
          isCompleted: true,
        },
      });
      // Refresh profile so updated issue scores and pending drill counts reflect immediately
      get().fetchProfile().catch(() => {});
    } else {
      set({
        session: {
          ...current,
          currentIndex: nextIdx,
        },
      });
    }
  },

  finishSession: () => {
    const current = get().session;
    set({
      session: {
        ...current,
        isCompleted: true,
      },
    });
    get().fetchProfile().catch(() => {});
  },

  fetchSessionDebrief: async (clusterId, answers = []) => {
    try {
      const totalAttempted = answers.length;
      const totalCorrect = answers.filter((a) => a.is_correct).length;
      const debrief = await curriculumApi.getSessionDebrief(clusterId, totalAttempted, totalCorrect, answers);
      return debrief;
    } catch (err) {
      return null;
    }
  },

  fetchReportForCluster: async (clusterId) => {
    try {
      const report = await curriculumApi.getReport(clusterId);
      set((state) => ({
        activeReports: {
          ...state.activeReports,
          [clusterId]: report,
        },
      }));
      return report;
    } catch (_) {
      return null;
    }
  },

  acknowledgeReport: async (reportId, clusterId) => {
    try {
      await curriculumApi.acknowledgeReport(reportId);
      set((state) => {
        const nextReports = { ...state.activeReports };
        if (clusterId && nextReports[clusterId]) {
          nextReports[clusterId] = {
            ...nextReports[clusterId],
            acknowledged_by_user: true,
          };
        }
        return {
          activeReports: nextReports,
          unreadReports: Math.max(0, state.unreadReports - 1),
        };
      });
    } catch (_) {}
  },

  fetchProgress: async () => {
    try {
      const data = await curriculumApi.getProgress();
      set({ progressData: data });
      return data;
    } catch (_) {
      return null;
    }
  },

  fetchHistory: async () => {
    try {
      const history = await curriculumApi.getHistory();
      set({ drillHistory: history || [] });
      return history;
    } catch (_) {
      return [];
    }
  },
}));
