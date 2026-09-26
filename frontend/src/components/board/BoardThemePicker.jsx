import React, { useState, useEffect, useRef, useCallback, Suspense, lazy, useMemo, Component } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGLTF } from '@react-three/drei';
import { useBoardThemeStore } from '../../store/boardThemeStore';
import { getTransparentPieceCellUrl, MODELS_3D, DEFAULT_MODEL_3D, PREVIEW_FEN } from '../../lib/boardThemes';

const Board3D = lazy(() => import('./Board3D'));

const DEFAULT_BOARD = 'Wood and Marble';

const BOARD_VARIANTS_2D = [
  'Glass and Marble', 'Glass and Stone', 'Glass and Wood',
  'Marble and Marble', 'Marble and Stone', 'Marble and Wood',
  'Plastic and Marble', 'Plastic and Metal', 'Plastic and Wood',
  'Wood and Marble', 'Wood and Metal', 'Wood and Wood',
];

const PIECE_VARIANTS = [
  { key: 'Marble 1',  label: 'Marble',  accent: '#C8C0B4', desc: 'Polished marble finish' },
  { key: 'Plastic 1', label: 'Plastic', accent: '#6CA8C0', desc: 'Clean modern plastic' },
  { key: 'Rust 1',    label: 'Rust',    accent: '#C07048', desc: 'Warm oxidised metal' },
  { key: 'Wood 1',    label: 'Wood',    accent: '#9C6B3A', desc: 'Classic carved wood' },
];

function boardImgPath(variant) {
  return `/chess-themes/2d/boards/${encodeURIComponent(`${variant} 512x552.png`)}`;
}

function PiecePreviewCell({ pieceKey, color, className }) {
  const src = useMemo(
    () => getTransparentPieceCellUrl(pieceKey, color, 'k'),
    [pieceKey, color]
  );
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={className}
      style={{ objectFit: 'contain', pointerEvents: 'none' }}
    />
  );
}

function ViewSelector({ current, onChange }) {
  return (
    <div className="btp-view-selector">
      {[
        { key: '2d', label: '2D', icon: '⬛', desc: 'Classic 2D view' },
        { key: '3d', label: '3D', icon: '◈', desc: 'Real-time 3D rendering' },
      ].map((v) => (
        <motion.button
          key={v.key}
          className={`btp-view-card ${current === v.key ? 'selected' : ''}`}
          onClick={() => onChange(v.key)}
          whileHover={{ scale: 1.03, y: -2 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 350, damping: 22 }}
        >
          <span className="btp-view-icon">{v.icon}</span>
          <div className="btp-view-info">
            <span className="btp-view-label">{v.label}</span>
            <span className="btp-view-desc">{v.desc}</span>
          </div>
          {current === v.key && (
            <motion.div className="btp-view-check" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400 }}>✓</motion.div>
          )}
        </motion.button>
      ))}
    </div>
  );
}

function BoardGrid({ selected, onSelect }) {
  return (
    <div className="btp-board-grid">
      {BOARD_VARIANTS_2D.map((v) => (
        <motion.button
          key={v}
          className={`btp-board-swatch ${selected === v ? 'selected' : ''}`}
          onClick={() => onSelect(v)}
          whileHover={{ scale: 1.06, y: -2 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          title={v}
        >
          <img src={boardImgPath(v)} alt={v} className="btp-board-swatch-img" loading="lazy" />
          {selected === v && (
            <motion.div className="btp-swatch-check" initial={{ scale: 0 }} animate={{ scale: 1 }}>✓</motion.div>
          )}
          <div className="btp-board-swatch-label">{v}</div>
        </motion.button>
      ))}
    </div>
  );
}

function PieceGrid({ selected, onSelect, boardLocked }) {
  return (
    <div className="btp-piece-grid-new">
      {PIECE_VARIANTS.map((pv) => {
        const isSelected = selected === pv.key;
        return (
          <motion.button
            key={pv.key}
            className={`btp-piece-swatch ${isSelected ? 'selected' : ''} ${boardLocked ? 'locked' : ''}`}
            onClick={() => !boardLocked && onSelect(pv.key)}
            whileHover={boardLocked ? {} : { scale: 1.05, y: -2 }}
            whileTap={boardLocked ? {} : { scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            title={boardLocked ? 'Select a board first' : pv.label}
          >
            <div className="btp-piece-swatch-images">
              <PiecePreviewCell pieceKey={pv.key} color="white" className="btp-piece-swatch-img wking" />
              <PiecePreviewCell pieceKey={pv.key} color="black" className="btp-piece-swatch-img bking" />
            </div>
            {isSelected && (
              <motion.div className="btp-swatch-check" initial={{ scale: 0 }} animate={{ scale: 1 }}>✓</motion.div>
            )}
            <div className="btp-board-swatch-label">{pv.label}</div>
          </motion.button>
        );
      })}
    </div>
  );
}

function Model3DCard({ model, selected, onSelect, status, showUnplayable, onAnalyzed }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const handleCardAnalyzed = useCallback((analysis) => {
    onAnalyzed(model.id, analysis);
  }, [model.id, onAnalyzed]);

  const isSelected = selected === model.id;
  const showPreviewBadge = showUnplayable && status === false;

  return (
    <motion.button
      ref={ref}
      type="button"
      className={`btp-swatch btp-board-swatch btp-model3d-card ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(model.id)}
      whileHover={{ scale: 1.04, y: -2 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      title={model.desc ? `${model.label} — ${model.desc}` : model.label}
    >
      <div className="btp-model3d-preview">
        {visible ? (
          <GLBErrorBoundary model3d={model.id} compact>
            <Suspense fallback={<div className="btp-3d-loading">Loading…</div>}>
              <Board3D
                fen={PREVIEW_FEN}
                preview={true}
                thumbnail={true}
                modelOverride={model.id}
                onAnalyzed={handleCardAnalyzed}
              />
            </Suspense>
          </GLBErrorBoundary>
        ) : (
          <div className="btp-3d-loading">Loading…</div>
        )}
        {showPreviewBadge && (
          <span className="btp-badge btp-model3d-badge preview-only">🖼 Preview only</span>
        )}
      </div>
      {isSelected && (
        <motion.div className="btp-swatch-check" initial={{ scale: 0 }} animate={{ scale: 1 }}>✓</motion.div>
      )}
      <div className="btp-board-swatch-label">{model.label}</div>
      {model.desc && <div className="btp-board-swatch-desc">{model.desc}</div>}
    </motion.button>
  );
}

function Model3DGrid({ selected, onSelect, statuses, showUnplayable, onAnalyzed }) {
  const visibleModels = MODELS_3D.filter((m) => showUnplayable || statuses[m.id] !== false);
  if (!visibleModels.length) {
    return (
      <div className="btp-3d-empty">
        No playable 3D models found. Enable “Show unplayable models” below to inspect new additions.
      </div>
    );
  }
  return (
    <div className="btp-board-grid btp-model3d-grid">
      {visibleModels.map((model) => (
        <Model3DCard
          key={model.id}
          model={model}
          selected={selected}
          onSelect={onSelect}
          status={statuses[model.id] ?? null}
          showUnplayable={showUnplayable}
          onAnalyzed={onAnalyzed}
        />
      ))}
    </div>
  );
}

class GLBErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMsg: error.message };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.model3d !== this.props.model3d) {
      this.setState({ hasError: false, errorMsg: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.compact) {
        return (
          <div className="btp-3d-loading" style={{ flexDirection: 'column', gap: '4px' }}>
            <span>⚠️ Preview failed</span>
          </div>
        );
      }
      return (
        <div className="alert alert-error" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h4>Failed to load 3D Model</h4>
          <p style={{ fontSize: '12px', opacity: 0.8, marginTop: '8px' }}>{this.state.errorMsg}</p>
          <button
            className="btn-neon interactive"
            style={{ marginTop: '16px', alignSelf: 'center' }}
            onClick={() => window.location.reload()}
          >
            Hard Refresh Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function BoardThemePicker({ onClose, inline = false }) {
  const { style, boardVariant, pieceVariant, model3d, showUnplayable3D, setStyle, setBoardVariant, setPieceVariant, setModel3d, setShowUnplayable3D } =
    useBoardThemeStore();

  const effectiveBoard = boardVariant || DEFAULT_BOARD;

  const [subTab, setSubTab] = useState('board');
  const boardLocked = !boardVariant;

  const [cardStatus, setCardStatus] = useState({});
  const handleCardAnalyzed = useCallback((id, analysis) => {
    const playable = analysis ? !!analysis.playable : false;
    setCardStatus((prev) => (prev[id] === playable ? prev : { ...prev, [id]: playable }));
  }, []);

  const safeModel3d = MODELS_3D.some((m) => m.id === model3d) ? model3d : DEFAULT_MODEL_3D;
  useEffect(() => {
    if (safeModel3d !== model3d) setModel3d(safeModel3d);
  }, [safeModel3d, model3d, setModel3d]);

  useEffect(() => {
    if (style !== '3d') return;
    try {
      MODELS_3D.forEach((m) => useGLTF.preload(`/chess-themes/3d/${m.id}?v=1`));
    } catch (_) {
    }
  }, [style]);

  const handleStyleChange = useCallback((newStyle) => {
    setStyle(newStyle);
    setSubTab('board');
  }, [setStyle]);

  const handleBoardSelect = useCallback((v) => {
    setBoardVariant(v);
  }, [setBoardVariant]);

  const handlePieceSelect = useCallback((k) => {
    if (!boardLocked) setPieceVariant(k);
  }, [boardLocked, setPieceVariant]);

  return (
    <div className={`btp-container ${inline ? 'btp-inline' : 'btp-panel'}`}>

      {!inline && (
        <div className="btp-header">
          <div className="btp-header-left">
            <span className="btp-header-icon">🎨</span>
            <div>
              <h3 className="btp-title">Board Style</h3>
              <p className="btp-subtitle">Personalize your chess experience</p>
            </div>
          </div>
          {onClose && (
            <button className="btp-close-btn" onClick={onClose} aria-label="Close">×</button>
          )}
        </div>
      )}

      <div className="btp-body">

        <div className="btp-section">
          <div className="btp-section-label">VIEW MODE</div>
          <ViewSelector current={style} onChange={handleStyleChange} />
        </div>

        <AnimatePresence>
          {style === '2d' && (
            <motion.div
              key="2d-options"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
            >
              <div className="btp-section">
                <div className="btp-section-label">2D OPTIONS</div>
                <div className="btp-subtabs">
                  <button
                    className={`btp-subtab ${subTab === 'board' ? 'active' : ''}`}
                    onClick={() => setSubTab('board')}
                  >
                    ⬛ Board
                  </button>
                  <button
                    className={`btp-subtab ${subTab === 'pieces' ? 'active' : ''} ${boardLocked ? 'disabled' : ''}`}
                    onClick={() => !boardLocked && setSubTab('pieces')}
                    title={boardLocked ? 'Select a board first' : 'Choose piece set'}
                  >
                    ♟ Pieces {boardLocked && <span className="btp-lock-icon">🔒</span>}
                  </button>
                </div>

                <div className="btp-subtab-content">
                  <AnimatePresence mode="wait">
                    {subTab === 'board' && (
                      <motion.div key="board" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.18 }}>
                        <BoardGrid selected={boardVariant || ''} onSelect={handleBoardSelect} />
                      </motion.div>
                    )}
                    {subTab === 'pieces' && !boardLocked && (
                      <motion.div key="pieces" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.18 }}>
                        <PieceGrid
                          selected={pieceVariant}
                          boardVariant={effectiveBoard}
                          onSelect={handlePieceSelect}
                          boardLocked={boardLocked}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {style === '3d' && (
          <div className="btp-section btp-3d-section">
            <div className="btp-section-label">3D MODEL SELECTION</div>

            <div className="btp-subtab-content" style={{ marginBottom: '12px' }}>
              <Model3DGrid
                selected={safeModel3d}
                onSelect={setModel3d}
                statuses={cardStatus}
                showUnplayable={showUnplayable3D}
                onAnalyzed={handleCardAnalyzed}
              />
            </div>

            <label className="btp-toggle-row" title="Reveal models the analyzer marks preview-only, so new additions can be checked and removed">
              <input
                type="checkbox"
                checked={!!showUnplayable3D}
                onChange={(e) => setShowUnplayable3D(e.target.checked)}
              />
              <span>Show unplayable models <em>(Preview only — for checking new additions)</em></span>
            </label>
          </div>
        )}

      </div>

      <div className="btp-footer">
        <span className="btp-footer-hint">⚡ Changes apply instantly — your preference is saved</span>
      </div>
    </div>
  );
}
