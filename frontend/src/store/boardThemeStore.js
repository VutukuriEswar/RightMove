import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_MODEL_3D, MODELS_3D, REMOVED_MODELS_3D } from '../lib/boardThemes';

const DEFAULT_THEME = {
  style: '2d',
  boardVariant: 'Wood and Marble',
  pieceVariant: 'Marble 1',
  model3d: DEFAULT_MODEL_3D,
  showUnplayable3D: false,
};

function migrateModel3d(model3d) {
  if (typeof model3d !== 'string') return DEFAULT_MODEL_3D;
  if (MODELS_3D.some((m) => m.id === model3d)) return model3d;
  if (REMOVED_MODELS_3D.includes(model3d)) return DEFAULT_MODEL_3D;
  return DEFAULT_MODEL_3D;
}

export const useBoardThemeStore = create(
  persist(
    (set) => ({
      ...DEFAULT_THEME,

      setStyle: (style) => set({ style }),

      setBoardVariant: (boardVariant) => set({ boardVariant }),

      setPieceVariant: (pieceVariant) => set({ pieceVariant }),

      setModel3d: (model3d) => set({ model3d }),

      setShowUnplayable3D: (showUnplayable3D) => set({ showUnplayable3D: !!showUnplayable3D }),

      setTheme: ({ style, boardVariant, pieceVariant, model3d }) =>
        set({ style, boardVariant, pieceVariant, model3d }),

      resetTheme: () => set(DEFAULT_THEME),
    }),
    {
      name: 'rightmove-board-theme',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.style === 'top-down' || state.style === 'isometric') {
          state.style = '2d';
        }
        state.model3d = migrateModel3d(state.model3d);
        if (typeof state.showUnplayable3D !== 'boolean') {
          state.showUnplayable3D = false;
        }
      },
    }
  )
);
