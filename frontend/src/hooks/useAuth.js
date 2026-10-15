import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../lib/api';

export function useAuth() {
  const { token, user, setUser, logout } = useAuthStore();

  useEffect(() => {
    if (token) {
      authApi.me()
        .then(setUser)
        .catch((e) => { if (e?.status === 401 || e?.status === 403) logout(); });
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    authApi.heartbeat().catch(() => {});
    const t = setInterval(() => authApi.heartbeat().catch(() => {}), 60000);
    return () => clearInterval(t);
  }, [token]);

  return { token, user, isLoggedIn: !!token, logout };
}
