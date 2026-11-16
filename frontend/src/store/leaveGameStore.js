import { create } from 'zustand';

export const useLeaveGameStore = create((set) => ({
  isOpen: false,
  onConfirm: null,
  onCancel: null,
  onPause: null,
  canPause: false,
  leaving: false,

  openLeaveDialog: ({ onConfirm, onCancel, onPause, canPause }) =>
    set((state) =>
      state.isOpen
        ? state
        : {
            isOpen: true,
            onConfirm: onConfirm ?? null,
            onCancel: onCancel ?? null,
            onPause: onPause ?? null,
            canPause: !!canPause,
          }
    ),

  closeLeaveDialog: () =>
    set({
      isOpen: false,
      onConfirm: null,
      onCancel: null,
      onPause: null,
      canPause: false,
    }),

  setLeaving: (v) => set({ leaving: !!v }),

  bypassOnce: false,

  allowLeaveOnce: () => set({ bypassOnce: true }),

  consumeBypass: () => {
    const active = useLeaveGameStore.getState().bypassOnce;
    if (active) useLeaveGameStore.setState({ bypassOnce: false });
    return active;
  },
}));
