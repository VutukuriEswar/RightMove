import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/api';
import { markTrainingSeen } from '../hooks/useTrainingBadge';

const SLIDERS = [
  { key: 'epochs', label: 'Epochs', min: 1, max: 20, step: 1 },
  { key: 'batch_size', label: 'Batch size', min: 8, max: 128, step: 8 },
  { key: 'num_blocks', label: 'Residual blocks', min: 1, max: 8, step: 1 },
];

const clampPct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
};

const shortId = (id) => (id || '').slice(0, 8);

export default function AdminTraining() {
  const [file, setFile] = useState(null);
  const [detectedGames, setDetectedGames] = useState(null);
  const [opts, setOpts] = useState({ epochs: 3, batch_size: 32, lr: 0.001, num_blocks: 4, channels: 128 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [models, setModels] = useState([]);
  const [env, setEnv] = useState(null);
  const [actionBusy, setActionBusy] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const loadJobs = async () => {
    try {
      const data = await adminApi.listJobs();
      setJobs(data.jobs || []);
      markTrainingSeen(data.jobs || []);
    } catch (e) { setError(e.message || 'Failed to load jobs'); }
  };

  const loadModels = async () => {
    try {
      const data = await adminApi.listModels();
      setModels(data.models || []);
    } catch (e) { setError(e.message || 'Failed to load models'); }
  };

  const loadEnv = async () => {
    try {
      const data = await adminApi.trainEnv();
      setEnv(data);
    } catch (_) {}
  };

  useEffect(() => {
    loadJobs();
    loadModels();
    loadEnv();
    const t = setInterval(() => { loadJobs(); loadModels(); }, 4000);
    return () => clearInterval(t);
  }, []);

  const onFile = async (f) => {
    setFile(f || null);
    setDetectedGames(null);
    if (!f) return;
    try {
      const text = await f.text();

      const events = (text.match(/\[Event\s+"/g) || []).length;
      setDetectedGames(events || null);
    } catch (_) {
      setDetectedGames(null);
    }
  };

  const start = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      await adminApi.startTraining(file, { ...opts, max_games: detectedGames || 0 });
      setFile(null);
      setDetectedGames(null);
      await loadJobs();
    } catch (e) { setError(e.message || 'Training start failed'); }
    finally { setBusy(false); }
  };

  const jobAction = async (jobId, fn) => {
    setActionBusy(jobId); setError(null);
    try {
      if (fn === 'delete') {
        if (!window.confirm('Delete this forging and ALL its checkpoints? This cannot be undone.')) return;
        await adminApi.deleteJob(jobId);
      } else {
        if (fn === 'pause') await adminApi.pauseJob(jobId);
        if (fn === 'resume') await adminApi.resumeJob(jobId);
      }
      await loadJobs(); await loadModels();
    } catch (e) { setError(e.message || 'Action failed'); }
    finally { setActionBusy(null); }
  };

  const modelAction = async (modelId, fn, extra) => {
    setActionBusy(modelId); setError(null);
    try {
      if (fn === 'delete') {
        if (modelId === 'legacy-best') {
          if (!window.confirm('Delete the built-in Legacy GM model and its checkpoint file? The GM features will fall back to Stockfish until another model is trained. This cannot be undone.')) return;
        } else if (!window.confirm('Delete this brain, its checkpoint file(s), its training upload and its forging record? This cannot be undone.')) return;
        await adminApi.deleteModel(modelId);
      } else if (fn === 'publish') {
        await adminApi.publishModel(modelId, extra);
      } else if (fn === 'rename') {
        const name = (extra || '').trim();
        if (!name) { setError('Name must not be empty'); return; }
        await adminApi.renameModel(modelId, name);
        setRenamingId(null);
        setRenameValue('');
      }
      await loadModels();
    } catch (e) { setError(e.message || 'Model action failed'); }
    finally { setActionBusy(null); }
  };

  const startRename = (m) => {
    setRenamingId(m.model_id);
    setRenameValue(m.name || m.model_id);
    setError(null);
  };

  const canPause = (j) => j.status === 'running' || j.status === 'pausing' || j.status === 'queued';
  const canResume = (j) => j.status === 'paused';

  const refreshAll = () => { loadJobs(); loadModels(); };

  const modelForJob = (j) =>
    models.find((m) => (j.model_id && m.model_id === j.model_id) || (m.job_id && m.job_id === j.job_id));
  const jobForModel = (m) =>
    jobs.find((j) => (j.model_id && j.model_id === m.model_id) || (m.job_id && m.job_id === j.job_id));

  const visibleJobs = jobs.filter((j) => !(j.status === 'done' && modelForJob(j)));

  const standaloneBrains = models.filter((m) => {
    const j = jobForModel(m);
    return !j || j.status === 'done';
  });

  const renderModelControls = (m) => {
    const busyRow = actionBusy === m.model_id;
    const isRenaming = renamingId === m.model_id;
    return (
      <div className="job-brain">
        <div className="job-top">
          {isRenaming ? (
            <span className="job-rename-row">
              <input
                className="job-rename-input interactive"
                value={renameValue}
                maxLength={120}
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') modelAction(m.model_id, 'rename', renameValue);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                placeholder="Model name…"
              />
            </span>
          ) : (
            <span className="job-id">🧠 {m.name || m.model_id}</span>
          )}
          {m.published
            ? <span className="job-status st-done">● published</span>
            : <span className="job-status st-paused">○ draft</span>}
        </div>
        <p className="job-meta">
          {m.positions ? `${m.positions} positions · ` : ''}
          {m.config ? `${m.config.max_games ?? '?'} games · ${m.config.epochs ?? '?'} epochs · ${m.config.num_blocks ?? '?'} blocks` : ''}
        </p>
        {m.checkpoint_path && <p className="job-ckpt">💾 {m.checkpoint_path}</p>}
        <div className="job-actions">
          {isRenaming ? (
            <>
              <button className="btn-sm interactive" disabled={busyRow || !renameValue.trim()} onClick={() => modelAction(m.model_id, 'rename', renameValue)}>
                ✓ Save
              </button>
              <button className="btn-sm interactive" disabled={busyRow} onClick={() => setRenamingId(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn-sm interactive" disabled={busyRow} onClick={() => startRename(m)}>
                ✏ Rename
              </button>
              {m.published ? (
                <button className="btn-sm interactive" disabled={busyRow} onClick={() => modelAction(m.model_id, 'publish', false)}>
                  📥 Unpublish
                </button>
              ) : (
                <button className="btn-sm interactive" disabled={busyRow} onClick={() => modelAction(m.model_id, 'publish', true)}>
                  🚀 Publish
                </button>
              )}
              <button
                className="btn-sm interactive btn-danger-ghost"
                disabled={busyRow || m.published}
                title={m.published ? 'Unpublish before deleting' : undefined}
                onClick={() => modelAction(m.model_id, 'delete')}
              >
                🗑 Delete
              </button>
              {m.published && !isRenaming && (
                <span className="job-meta">Unpublish to enable delete.</span>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <motion.div className="page admin-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="admin-hero">
        <div className="admin-crest">🧠</div>
        <h1>The Forge</h1>
        <p>Train the ResNet policy-value brain on grandmaster games. Models stay private drafts until you publish them — only published brains reach players.</p>
      </div>

      {env && !env.torch_available && (
        <div className="alert alert-error">
          Training engine unavailable: torch is not installed on the server. {env.hint || 'Install torch, then retry.'}
        </div>
      )}

      {env?.storage && (
        <div className={`glass-panel storage-card ${env.storage.over_threshold ? 'storage-over' : ''}`}>
          <div className="storage-head">
            <span>🗄 MongoDB storage</span>
            <strong>{env.storage.percent}% · {env.storage.used_mb} / {env.storage.capacity_mb} MB</strong>
          </div>
          <div className="job-bar" role="progressbar" aria-valuenow={env.storage.percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="job-fill" style={{ width: `${Math.min(100, env.storage.percent)}%` }} />
          </div>
          {env.storage.over_threshold ? (
            <p className="storage-warn">
              ⚠ Over the {env.storage.threshold_pct}% budget — please clear storage (delete old
              forgings/models) to go back under. New uploads stay in the disk folder until
              then, and migrate back automatically.
            </p>
          ) : (
            <p className="job-meta">Uploads live in MongoDB while under the {env.storage.threshold_pct}% budget.</p>
          )}
          {env.storage_message && !env.storage.over_threshold && (
            <p className="job-meta">{env.storage_message}</p>
          )}
        </div>
      )}

      <div className="train-grid">

        <motion.div
          className="glass-panel train-card"
          initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 90, damping: 18 }}
        >
          <h2>⚗️ New forging</h2>
          <p>Upload a PGN rich with games. All games in the file are used — training runs in the background and checkpoints land in <code>backend/checkpoints/</code>.</p>

          <label className={`dropzone interactive ${file ? 'has-file' : ''}`}>
            <input type="file" accept=".pgn,.txt" onChange={(e) => onFile(e.target.files?.[0] || null)} hidden />
            <span className="dropzone-icon">📥</span>
            <span className="dropzone-text">{file ? file.name : 'Choose a PGN file…'}</span>
            <span className="dropzone-sub">
              {file
                ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${detectedGames != null ? `${detectedGames} game(s) detected` : 'counting games…'}`
                : 'grandmaster_games.pgn…'}
            </span>
          </label>

          {SLIDERS.map((s) => (
            <div key={s.key} className="slider-row">
              <div className="slider-row-head"><span>{s.label}</span><em>{opts[s.key]}</em></div>
              <input
                type="range" min={s.min} max={s.max} step={s.step} value={opts[s.key]}
                onChange={(e) => setOpts((o) => ({ ...o, [s.key]: Number(e.target.value) }))}
              />
            </div>
          ))}
          <div className="slider-row">
            <div className="slider-row-head"><span>Learning rate</span><em>{opts.lr}</em></div>
            <input
              type="range" min={0.0001} max={0.01} step={0.0001} value={opts.lr}
              onChange={(e) => setOpts((o) => ({ ...o, lr: Number(e.target.value) }))}
            />
          </div>

          <button className="btn-neon interactive train-start" onClick={start} disabled={!file || busy}>
            {busy ? 'Kindling the forge…' : '🔥 Start training'}
          </button>
          {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
        </motion.div>

        <motion.div
          className="glass-panel train-card"
          initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 90, damping: 18, delay: 0.08 }}
        >
          <div className="jobs-head">
            <h2><span className="live-dot" />Forgings</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Link className="btn-sm interactive" to="/learn">⚔ Try in Learn</Link>
              <button className="btn-sm interactive" onClick={refreshAll}>Refresh</button>
            </div>
          </div>
          <p className="coach-text">A finished forging becomes a brain below. Brains stay <strong>drafts</strong> until published — only <strong>published</strong> ones reach players.</p>
          {visibleJobs.length === 0 && standaloneBrains.length === 0 && (
            <div className="admin-empty" style={{ padding: '30px 16px' }}>
              <div className="admin-empty-icon">🏺</div>
              <p>No forgings yet. Light the first fire on the left.</p>
            </div>
          )}
          {(visibleJobs || []).map((j) => {
            const pct = clampPct(j.progress);
            const busyRow = actionBusy === j.job_id;

            const brain = modelForJob(j);
            return (
              <div key={j.job_id} className="job-card">
                <div className="job-top">
                  <span className="job-id">⚒ {shortId(j.job_id)}</span>
                  <span className={`job-status st-${j.status}`}>{j.status}</span>
                  <span className="job-pct">{pct}%</span>
                </div>
                <div className="job-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="job-fill" style={{ width: `${pct}%` }} />
                </div>
                <p className="job-meta">
                  {j.config ? `${j.config.detected_games != null ? `${j.config.detected_games} detected · ` : ''}${j.config.max_games} games · ${j.config.epochs} epochs · ${j.config.num_blocks} blocks` : ''}
                  {j.current_epoch ? ` · epoch ${j.current_epoch}` : ''}
                  {j.current_loss != null ? ` · loss ${j.current_loss}` : ''}
                  {j.positions ? ` · ${j.positions} positions` : ''}
                </p>
                {(j.log || []).slice(-3).map((l, i) => <p key={i} className="job-meta">• {l}</p>)}
                {j.checkpoint_path && <p className="job-ckpt">💾 {j.checkpoint_path}</p>}
                {j.error && <p className="job-err">⚠ {j.error}</p>}
                <div className="job-actions">
                  {canPause(j) && (
                    <button className="btn-sm interactive" disabled={busyRow} onClick={() => jobAction(j.job_id, 'pause')}>
                      ⏸ Pause
                    </button>
                  )}
                  {canResume(j) && (
                    <button className="btn-sm interactive" disabled={busyRow} onClick={() => jobAction(j.job_id, 'resume')}>
                      ▶ Resume{j.resume_from ? ` at epoch ${j.resume_from + 1}` : ''}
                    </button>
                  )}
                  <button
                    className="btn-sm interactive btn-danger-ghost"
                    disabled={busyRow || !!brain?.published}
                    title={brain?.published ? 'Unpublish the brain before deleting this forging' : undefined}
                    onClick={() => jobAction(j.job_id, 'delete')}
                  >
                    🗑 Delete
                  </button>
                </div>
                {j.status === 'paused' && (
                  <p className="job-meta">⏸ Paused — resume restarts epoch {(j.resume_from || 0) + 1} from scratch.</p>
                )}
              </div>
            );
          })}
          {standaloneBrains.map((m) => (
            <div key={m.model_id} className="job-card">
              {renderModelControls(m)}
            </div>
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}
