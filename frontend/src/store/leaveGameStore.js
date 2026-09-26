import { create } from 'zustand';

export const useLeaveGameStore = create((set) => ({
  isOpen: false,
  onConfirm: null,
  onCancel: null,

  openLeaveDialog: ({ onConfirm, onCancel }) =>
    set((state) =>
      state.isOpen
        ? state
        : { isOpen: true, onConfirm: onConfirm ?? null, onCancel: onCancel ?? null }
    ),

  closeLeaveDialog: () => set({ isOpen: false, onConfirm: null, onCancel: null }),
}));
