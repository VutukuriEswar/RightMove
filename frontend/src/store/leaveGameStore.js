import { create } from 'zustand';

export const useLeaveGameStore = create((set) => ({
  isOpen: false,
  onConfirm: null,
  onCancel: null,
  leaving: false,

  openLeaveDialog: ({ onConfirm, onCancel }) =>
    set((state) =>
      state.isOpen
        ? state
        : { isOpen: true, onConfirm: onConfirm ?? null, onCancel: onCancel ?? null }
    ),

  closeLeaveDialog: () => set({ isOpen: false, onConfirm: null, onCancel: null }),

  setLeaving: (v) => set({ leaving: !!v }),

  bypassOnce: false,

  allowLeaveOnce: () => set({ bypassOnce: true }),

  consumeBypass: () => {
    const active = useLeaveGameStore.getState().bypassOnce;
    if (active) useLeaveGameStore.setState({ bypassOnce: false });
    return active;
  },
}));
