import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { adminApi } from '../lib/api';

const KEY = 'rm_seen_jobs';

function readSeen() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch (_) {
    return {};
  }
}

export function markTrainingSeen(jobs) {
  try {
    const seen = readSeen();
    (jobs || []).forEach((j) => { if (j.job_id) seen[j.job_id] = j.status; });
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch (_) {}
}

export function useTrainingBadge(isAdmin) {
  const token = useAuthStore((s) => s.token);
  const [finished, setFinished] = useState(0);

  useEffect(() => {
    if (!token || !isAdmin) {
      setFinished(0);
      return;
    }
    let alive = true;
    const poll = () => {
      adminApi.listJobs()
        .then((d) => {
          if (!alive) return;
          const jobs = d.jobs || [];
          let stored = null;
          try {
            stored = localStorage.getItem(KEY);
          } catch (_) {
            stored = '{}';
          }
          if (stored === null) {
            markTrainingSeen(jobs);
            setFinished(0);
            return;
          }
          const seen = readSeen();
          let n = 0;
          jobs.forEach((j) => {
            if ((j.status === 'done' || j.status === 'failed') && seen[j.job_id] !== j.status) n += 1;
          });
          setFinished(n);
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [token, isAdmin]);

  return finished;
}
