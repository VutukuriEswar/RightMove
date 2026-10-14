import { useAuthStore } from '../store/authStore';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

async function request(method, path, body = null) {
  const token = useAuthStore.getState().token;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Network error' }));
    const error = new Error(err.detail || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get:    (path)        => request('GET', path),
  post:   (path, body)  => request('POST', path, body),
  put:    (path, body)  => request('PUT', path, body),
  patch:  (path, body)  => request('PATCH', path, body),
  delete: (path)        => request('DELETE', path),
};

export const authApi = {
  signup: (username, email, password) =>
    api.post('/auth/signup', { username, email, password }),
  login: (email, password) =>
    api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  updateProfile: (updates) => api.patch('/auth/me', updates),
  uploadAvatar: async (file) => {
    const token = useAuthStore.getState().token;
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE_URL}/auth/me/avatar`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },
};

export const gamesApi = {
  create: (payload) => api.post('/games/', payload),
  get: (gameId) => api.get(`/games/${gameId}`),
  getMyStats: () => api.get('/games/mine/stats'),
  getSummary: (gameId) => api.get(`/games/${gameId}/summary`),
  getMoves: (gameId) => api.get(`/games/${gameId}/moves`),
  chooseColor: (gameId, player_color) =>
    api.post(`/games/${gameId}/choose-color`, { player_color }),
  updateBotConfig: (gameId, cfg) =>
    api.patch(`/games/${gameId}/bot-config`, cfg),
};

export const adminApi = {
  listUsers: (q = '') => api.get(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  updateUser: (userId, body) => api.patch(`/admin/users/${userId}`, body),
  userOverview: (userId) => api.get(`/admin/users/${userId}/overview`),
  startTraining: async (file, opts = {}) => {
    const { useAuthStore } = await import('../store/authStore');
    const token = useAuthStore.getState().token;
    const form = new FormData();
    form.append('file', file);
    form.append('max_games', String(opts.max_games ?? 200));
    form.append('epochs', String(opts.epochs ?? 3));
    form.append('batch_size', String(opts.batch_size ?? 32));
    form.append('lr', String(opts.lr ?? 0.001));
    form.append('num_blocks', String(opts.num_blocks ?? 4));
    form.append('channels', String(opts.channels ?? 128));
    const res = await fetch(`${BASE_URL}/admin/train`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Training start failed' }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },
  listJobs: () => api.get('/admin/train/jobs'),
  jobStatus: (jobId) => api.get(`/admin/train/jobs/${jobId}`),
  trainEnv: () => api.get('/admin/train/env'),
  pauseJob: (jobId) => api.post(`/admin/train/jobs/${jobId}/pause`, {}),
  resumeJob: (jobId) => api.post(`/admin/train/jobs/${jobId}/resume`, {}),
  deleteJob: (jobId) => api.delete(`/admin/train/jobs/${jobId}`),
  listModels: () => api.get('/admin/models'),
  publishModel: (modelId, published = true, name = null) =>
    api.post(`/admin/models/${modelId}/publish`, { published, ...(name ? { name } : {}) }),
  renameModel: (modelId, name) =>
    api.patch(`/admin/models/${modelId}`, { name }),
  deleteModel: (modelId) => api.delete(`/admin/models/${modelId}`),
};

export const learnApi = {
  analyzePgn: async (file) => {
    const { useAuthStore } = await import('../store/authStore');
    const token = useAuthStore.getState().token;
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE_URL}/learn/analyze-pgn`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'PGN analysis failed' }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },
  analyzePosition: (fen, top_k = 3) => api.post('/learn/analyze-position', { fen, top_k }),
};

export const friendsApi = {
  list: () => api.get('/friends/'),
  sendRequest: (username) => api.post('/friends/request', { username }),
  accept: (username) => api.post('/friends/accept', { username }),
};

export const coachApi = {
  explain: (fen, player_move_uci, best_move_uci, cp_loss, classification) =>
    api.post('/coach/explain', { fen, player_move_uci, best_move_uci, cp_loss, classification }),
  position: (fen) =>
    api.post('/coach/position', { fen }),
  simulate: (fen, move, n_moves = 5, depth = 12, user_color = 'white') =>
    api.post('/coach/simulate', { fen, move, n_moves, depth, user_color }),
  candidates: (fen, count = 10, depth = 12) =>
    api.post('/coach/candidates', { fen, count, depth }),
  motifs: (fen) =>
    api.post('/coach/motifs', { fen }),
  gmModels: () => api.get('/coach/gm-models'),
  gmChallenge: (model_id = null) =>
    api.get(`/coach/gm-challenge${model_id ? `?model_id=${encodeURIComponent(model_id)}` : ''}`),
  gmScore: (fen, user_move_uci, model_id = null) =>
    api.post('/coach/gm-challenge/score', { fen, user_move_uci, ...(model_id ? { model_id } : {}) }),
};

export const reportApi = {
  fullReport: (pgn_text) =>
    api.post('/report/full-report', { pgn_text }),
  downloadPdf: async (pgn_text) => {
    const token = useAuthStore.getState().token;
    const res = await fetch(`${BASE_URL}/report/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ pgn_text }),
    });
    if (!res.ok) throw new Error('PDF generation failed');
    return res.blob();
  },
};

const WS_BASE = (process.env.REACT_APP_WS_URL || 'ws://localhost:8000');

export function createGameSocket(gameId, token) {
  return new WebSocket(`${WS_BASE}/ws/game/${gameId}?token=${token}`);
}

export function createMatchmakingSocket(token, timeControlSeconds = 600, incrementSeconds = 0) {
  return new WebSocket(
    `${WS_BASE}/ws/matchmaking?token=${token}&tc=${timeControlSeconds}&inc=${incrementSeconds}`
  );
}
