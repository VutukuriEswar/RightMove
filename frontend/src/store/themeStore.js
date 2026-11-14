import { create } from 'zustand';

const getInitialTheme = () => {
  const savedTheme = localStorage.getItem('rightmove-theme');
  if (savedTheme) return savedTheme;
  return 'dark';
};

const initTheme = getInitialTheme();
document.documentElement.setAttribute('data-theme', initTheme);
if (typeof document !== 'undefined' && document.body) {
  document.body.setAttribute('data-theme', initTheme);
}

export const useThemeStore = create((set) => ({
  theme: initTheme,
  toggleTheme: () => set((state) => {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('rightmove-theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    if (document.body) {
      document.body.setAttribute('data-theme', newTheme);
    }
    return { theme: newTheme };
  })
}));
