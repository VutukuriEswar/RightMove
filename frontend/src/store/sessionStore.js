import { create } from 'zustand';

export const useSessionStore = create((set) => ({
  tabId: null,
  owned: false,
  suspended: false,
  prompt: null,
  movedAway: false,
  idle: false,

  setTabId: (tabId) => set({ tabId }),
  setOwned: (owned) => set({ owned }),
  setSuspended: (suspended) => set({ suspended }),
  setPrompt: (prompt) => set({ prompt }),
  setMovedAway: (movedAway) => set({ movedAway }),
  setIdle: (idle) => set({ idle }),
}));
