import { create } from 'zustand';

export const useGameStore = create((set, get) => ({
  gameId: null,
  mode: null,
  playerColor: 'white',
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves: [],
  clocks: { white: 600000, black: 600000 },
  result: null,
  trainingMode: false,
  trainingAnalysis: null,
  humanMoveFeedback: null,
  serverError: null,
  hasTimer: false,
  botEngine: null,
  botDepth: null,
  maiaElo: null,
  canTakeback: false,
  canRedo: false,
  pendingDrawOffer: null,
  drawOfferSent: false,
  drawDeclinedMsg: null,
  drawCooling: false,
  bothReady: false,
  waitingForOpponent: false,
  gamePausedBy: null,
  opponentUsername: null,
  boardFlipped: false,
  gameBegun: false,
  setGameBegun: (begun) => set({ gameBegun: begun }),
  initGame: (gameId, mode, playerColor, timeControlMs, trainingMode, extra = {}) => {
    const prev = get();
    if (prev.gameId === gameId && prev.moves.length > 0) {
      set({
        mode,
        playerColor,
        trainingMode,
        hasTimer: (timeControlMs ?? 0) > 0,
        serverError: null,
        botEngine: extra.botEngine ?? prev.botEngine,
        botDepth: extra.botDepth ?? prev.botDepth,
        maiaElo: extra.maiaElo ?? prev.maiaElo,
      });
      return;
    }
    set({
      gameId,
      mode,
      playerColor,
      trainingMode,
      hasTimer: (timeControlMs ?? 0) > 0,
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: [],
      clocks: { white: timeControlMs, black: timeControlMs },
      result: null,
      trainingAnalysis: null,
      humanMoveFeedback: null,
      serverError: null,
      botEngine: extra.botEngine ?? null,
      botDepth: extra.botDepth ?? null,
      maiaElo: extra.maiaElo ?? null,
      canTakeback: false,
      canRedo: false,
      pendingDrawOffer: null,
      drawOfferSent: false,
      drawDeclinedMsg: null,
      drawCooling: false,
      bothReady: false,
      waitingForOpponent: false,
      gamePausedBy: null,
      opponentUsername: null,
      boardFlipped: false,
      gameBegun: false,
    });
  },

  syncPosition: (fen, moves, flags = {}) =>
    set((state) => ({
      fen,
      moves: Array.isArray(moves) ? moves : state.moves,
      canTakeback: flags.canTakeback ?? (Array.isArray(moves) ? moves.length > 0 : state.canTakeback),
      canRedo: flags.canRedo ?? state.canRedo,
    })),

  applyMove: (moveRecord) =>
    set((state) => {
      if (state.moves.some((m) => m.ply === moveRecord.ply)) return state;
      return {
        fen: moveRecord.fen,
        moves: [...state.moves, moveRecord],
      };
    }),

  updateClocks: (clocks) => set({ clocks }),

  setResult: (result) => set({ result }),

  setTrainingAnalysis: (analysis) => set({ trainingAnalysis: analysis }),

  flipBoard: () => set((state) => {
    if (state.moves.length > 0 || state.result) return state;
    return { boardFlipped: !state.boardFlipped };
  }),

  reset: () =>
    set({
      gameId: null,
      mode: null,
      playerColor: 'white',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: [],
      clocks: { white: 600000, black: 600000 },
      result: null,
      trainingMode: false,
      trainingAnalysis: null,
      humanMoveFeedback: null,
      serverError: null,
      hasTimer: false,
      botEngine: null,
      botDepth: null,
      maiaElo: null,
      canTakeback: false,
      canRedo: false,
      pendingDrawOffer: null,
      drawOfferSent: false,
      drawDeclinedMsg: null,
      drawCooling: false,
      bothReady: false,
      waitingForOpponent: false,
      gamePausedBy: null,
      opponentUsername: null,
      boardFlipped: false,
      gameBegun: false,
    }),
}));
