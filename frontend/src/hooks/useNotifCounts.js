import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { friendsApi } from '../lib/api';

export function useNotifCounts() {
  const token = useAuthStore((s) => s.token);
  const [counts, setCounts] = useState({ friend_requests: 0, challenge_requests: 0 });

  useEffect(() => {
    if (!token) {
      setCounts({ friend_requests: 0, challenge_requests: 0 });
      return;
    }
    let alive = true;
    const poll = () => {
      friendsApi.notifCounts()
        .then((d) => {
          if (alive) setCounts({
            friend_requests: d.friend_requests || 0,
            challenge_requests: d.challenge_requests || 0,
          });
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [token]);

  return counts;
}
