import React, { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { Chess } from 'chess.js';
import { useBoardThemeStore } from '../../store/boardThemeStore';
import { analyzeModel } from '../../lib/analyzeModel';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function gridToWorld(board, square) {
  const file = square[0];
  const rank = +square[1];
  let ix, iz;
  
  if (board.invertX) {
    ix = 7 - FILES.indexOf(file);
  } else {
    ix = FILES.indexOf(file);
  }

  if (board.whiteAtZ0) {
    iz = rank - 1;
  } else {
    iz = 7 - (rank - 1);
  }

  return {
    x: board.minX + ix * board.cellX + board.cellX / 2,
    z: board.minZ + iz * board.cellZ + board.cellZ / 2,
  };
}

function worldToSquare(board, localX, localZ) {
  const ix = Math.floor((localX - board.minX) / board.cellX);
  const iz = Math.floor((localZ - board.minZ) / board.cellZ);
  if (ix < 0 || ix > 7 || iz < 0 || iz > 7) return null;
  let file, rank;
  
  if (board.invertX) {
    file = FILES[7 - ix];
  } else {
    file = FILES[ix];
  }
  
  if (board.whiteAtZ0) {
    rank = iz + 1;
  } else {
    rank = 8 - iz;
  }
  return `${file}${rank}`;
}

function usePieceClones(cluster) {
  return useMemo(() => {
    if (!cluster) return null;
    return cluster.meshes.map((m) => {
      const clone = m.obj.clone();
      clone.visible = true;
      clone.traverse((n) => {
        n.visible = true;
        if (n.isMesh && n.material) {
          n.material = Array.isArray(n.material)
            ? n.material.map((mat) => mat.clone())
            : n.material.clone();
        }
      });

      m.obj.updateWorldMatrix(true, false);
      m.obj.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);

      clone.position.sub(cluster.origin);
      clone.updateMatrixWorld(true);
      return clone;
    });
  }, [cluster]);
}

function ModelPiece({ cluster, square, board, opacity = 1, lift = 0 }) {
  const clones = usePieceClones(cluster);
  const gpos = gridToWorld(board, square);

  useEffect(() => {
    if (!clones) return;
    clones.forEach((clone) => {
      clone.traverse((n) => {
        if (n.isMesh && n.material) {
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          mats.forEach((mat) => {
            mat.transparent = opacity < 1;
            mat.opacity = opacity;
            mat.needsUpdate = true;
          });
        }
      });
    });
  }, [clones, opacity]);

  const groupRef = useRef();

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.set(gpos.x, cluster.origin.y + lift, gpos.z);
    }
  }, []);

  useFrame((state, delta) => {
    if (groupRef.current) {
      const target = new THREE.Vector3(gpos.x, cluster.origin.y + lift, gpos.z);
      groupRef.current.position.lerp(target, delta * 15);
    }
  });

  if (!clones) return null;
  return (
    <group ref={groupRef}>
      {clones.map((c, i) => <primitive key={i} object={c} />)}
    </group>
  );
}

function SquareOverlay({ square, board, color, radius = 0.42, height = 0.03, opacity = 0.55, shape = 'plane' }) {
  const pos = gridToWorld(board, square);
  const scale = board.cellX;
  const common = {
    position: [pos.x, board.floorY + height, pos.z],
    rotation: [-Math.PI / 2, 0, 0],
  };
  if (shape === 'ring') {
    return (
      <mesh {...common}>
        <ringGeometry args={[scale * (radius - 0.06), scale * radius, 56]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    );
  }
  return (
    <mesh {...common}>
      <circleGeometry args={[scale * radius, 56]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function BoardCatcher({ board, meshRef, onSquarePick }) {
  const size = board.size;
  const pos = {
    x: board.minX + size.x / 2,
    y: board.floorY,
    z: board.minZ + size.z / 2,
  };
  return (
    <mesh
      ref={meshRef}
      position={[pos.x, pos.y, pos.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSquarePick(e.point);
      }}
    >
      <planeGeometry args={[size.x + board.cellX * 2, size.z + board.cellZ * 2]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function DragBridge({ host }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    host.gl = gl;
    host.camera = camera;
  }, [gl, camera, host]);
  return null;
}

function AutoFit({ controlsRef, target, fitKey, cancelledRef }) {
  const doneRef = useRef(false);
  useEffect(() => { doneRef.current = false; }, [fitKey, target]);
  useFrame(() => {
    if (doneRef.current || cancelledRef.current) return;
    const c = controlsRef.current;
    if (!c) return;
    const cam = c.object;
    const dir = new THREE.Vector3().subVectors(cam.position, c.target);
    const d = dir.length();
    if (Math.abs(d - target) > 0.05) {
      dir.setLength(THREE.MathUtils.lerp(d, target, 0.12));
      cam.position.copy(c.target).add(dir);
      cam.updateProjectionMatrix();
    } else {
      doneRef.current = true;
    }
  });
  return null;
}

const P_MODES = {
  q: { w: '♛', b: '♕' },
  r: { w: '♜', b: '♖' },
  b: { w: '♝', b: '♗' },
  n: { w: '♞', b: '♘' },
};

export default function Board3D({
  fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  playerColor = 'white',
  flipped = false,
  onMove,
  disabled = false,
  lastMove = null,
  highlightSquares = [],
  preview = false,
  zoom = null,
  onFallbackTo2D,
  onAnalyzed,
  modelOverride = null,
  thumbnail = false,
}) {
  const { model3d: storedModel } = useBoardThemeStore();
  const model3d = modelOverride ?? storedModel;

  const containerRef = useRef(null);
  const boardGroupRef = useRef(null);
  const controlsRef = useRef(null);
  const catcherRef = useRef(null);
  const chessRef = useRef(null);
  if (!chessRef.current) chessRef.current = new Chess(fen);

  const [size, setSize] = useState(0);
  const [selected, setSelected] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [promotion, setPromotion] = useState(null);
  const [drag, setDrag] = useState(null);
  const [hoverSquare, setHoverSquare] = useState(null);

  const dragHost = useMemo(() => ({ gl: null, camera: null }), []);
  const raycaster = useRef(new THREE.Raycaster());
  const dragFromRef = useRef(null);
  const userZoomedRef = useRef(false);
  useEffect(() => { userZoomedRef.current = false; }, [model3d]);

  const gltf = useGLTF(`/chess-themes/3d/${model3d}?v=1`);

  const { analysis, clonedScene } = useMemo(() => {
    if (!gltf) return { analysis: null, clonedScene: null };
    const clone = gltf.scene.clone();
    let result = null;
    try {
      result = analyzeModel(clone, model3d);
    } catch (_) {
      result = null;
    }
    return { analysis: result, clonedScene: clone };
  }, [gltf, model3d]);

  const playable = !!analysis?.playable;
  const board = analysis?.board || null;

  useEffect(() => {
    if (!analysis || !clonedScene) return;
    const showStatics = preview || !playable;
    analysis.pieces.forEach((p) => {
      p.meshes.forEach((m) => { if (m.obj && m.obj.parent) m.obj.visible = showStatics; });
    });
  }, [analysis, clonedScene, preview, playable]);

  useEffect(() => {
    onAnalyzed?.(analysis);
  }, [analysis, onAnalyzed]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      let s = Math.floor(Math.min(w, h));
      if (h < 60) s = Math.floor(w);
      if (s > 60) setSize(s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const myColor = playerColor === 'white' ? 'w' : 'b';
  const showFlipped = flipped
    ? playerColor === 'white' ? 'black' : 'white'
    : playerColor;
  const boardRotY = showFlipped === 'black' ? Math.PI : 0;

  const { checkSquare, activePieces } = useMemo(() => {
    const c = chessRef.current;
    try { c.load(fen); } catch (_) {}
    const bb = c.board();
    const pieces = [];
    bb.forEach((row, r) => row.forEach((pc, col) => {
      if (pc) pieces.push({ ...pc, square: FILES[col] + (8 - r) });
    }));
    let king = null;
    if (c.inCheck()) {
      outer: for (let r = 0; r < 8; r++) {
        for (let col = 0; col < 8; col++) {
          const pc = bb[r][col];
          if (pc && pc.type === 'k' && pc.color === c.turn()) {
            king = FILES[col] + (8 - r);
            break outer;
          }
        }
      }
    }
    return { checkSquare: king, activePieces: pieces };
  }, [fen]);

  const assignedPieces = useMemo(() => {
    if (!analysis) return [];
    const pools = new Map();
    analysis.pieces.forEach((p) => {
      const k = `${p.color}${p.type}`;
      if (!pools.has(k)) pools.set(k, []);
      pools.get(k).push(p);
    });
    const sqDist = (a, b) =>
      Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])) + Math.abs(+a[1] - +b[1]);
    const used = new Set();
    const allClusters = analysis.pieces;
    return activePieces
      .map((pc) => {
        const k = `${pc.color}${pc.type}`;
        let best = null;
        let bestD = Infinity;
        (pools.get(k) || []).forEach((cl) => {
          if (used.has(cl)) return;
          const d = sqDist(cl.square, pc.square);
          if (d < bestD) { bestD = d; best = cl; }
        });
        if (!best) {
          best =
            (pools.get(`${pc.color}p`) || []).find((cl) => !used.has(cl)) ||
            allClusters.find((cl) => cl.color === pc.color && !used.has(cl)) ||
            null;
        }
        if (!best) return null;
        used.add(best);
        return { pc, cluster: best };
      })
      .filter(Boolean);
  }, [analysis, activePieces]);

  const deselect = useCallback(() => {
    setSelected(null);
    setLegalMoves([]);
  }, []);

  const selectSquare = useCallback((square) => {
    const c = chessRef.current;
    setSelected(square);
    setLegalMoves(c.moves({ square, verbose: true }).map((m) => m.to));
  }, []);

  const makeMove = useCallback((from, to, promo = 'q') => {
    if (disabled) return false;
    const c = chessRef.current;
    const res = c.move({ from, to, promotion: promo });
    if (!res) return false;
    c.undo();
    const uci = `${from}${to}${res.promotion ? promo : ''}`;
    deselect();
    onMove?.(uci);
    return true;
  }, [disabled, onMove, deselect]);

  const tryMoveFrom = useCallback((from, to) => {
    if (disabled) return false;
    const c = chessRef.current;
    const legal = c.moves({ square: from, verbose: true }).some((m) => m.to === to);
    if (!legal) return false;
    const piece = c.get(from);
    const isProm = piece?.type === 'p' &&
      ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));
    if (isProm) {
      setPromotion({ from, to });
      return true;
    }
    return makeMove(from, to);
  }, [disabled, makeMove]);

  const handleSquarePick = useCallback((payload) => {
    if (disabled || !playable || !boardGroupRef.current) return;
    let square;
    if (typeof payload === 'string') {
      square = payload;
    } else {
      const local = boardGroupRef.current.worldToLocal(payload.clone());
      square = worldToSquare(board, local.x, local.z);
    }
    if (!square) return;

    const c = chessRef.current;

    if (selected && legalMoves.includes(square)) {
      tryMoveFrom(selected, square);
      return;
    }

    const piece = c.get(square);
    if (piece && piece.color === myColor) {
      selectSquare(square);
    } else {
      deselect();
    }
  }, [disabled, playable, board, selected, legalMoves, tryMoveFrom, myColor, selectSquare, deselect]);

  const getDragSquare = useCallback((clientX, clientY) => {
    const gl = dragHost.gl;
    if (!gl || !board || !catcherRef.current) return null;
    const rect = gl.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.current.setFromCamera({ x: nx, y: ny }, dragHost.camera);
    const hits = raycaster.current.intersectObject(catcherRef.current, false);
    if (!hits.length || !boardGroupRef.current) return null;
    const local = boardGroupRef.current.worldToLocal(hits[0].point.clone());
    return worldToSquare(board, local.x, local.z);
  }, [board, dragHost]);

  const startDrag = useCallback((fromSquare, event) => {
    if (disabled || !playable) return;
    const p = chessRef.current.get(fromSquare);
    if (!p || p.color !== myColor) return;
    event.stopPropagation();
    if (controlsRef.current) controlsRef.current.enabled = false;
    dragFromRef.current = fromSquare;
    setDrag({ from: fromSquare });

    const onMoveEvt = (ev) => setHoverSquare(getDragSquare(ev.clientX, ev.clientY));
    const onUpEvt = (ev) => {
      window.removeEventListener('pointermove', onMoveEvt);
      window.removeEventListener('pointerup', onUpEvt);
      if (controlsRef.current) controlsRef.current.enabled = true;
      const sq = getDragSquare(ev.clientX, ev.clientY);
      const from = dragFromRef.current;
      dragFromRef.current = null;
      setDrag(null);
      setHoverSquare(null);
      if (from && sq) tryMoveFrom(from, sq);
    };
    window.addEventListener('pointermove', onMoveEvt);
    window.addEventListener('pointerup', onUpEvt);
  }, [disabled, playable, myColor, getDragSquare, tryMoveFrom]);

  const lastMoveSquares = useMemo(() => {
    if (!lastMove?.from || !lastMove?.to) return new Set();
    const isSq = (s) => typeof s === 'string' && /^[a-h][1-8]$/.test(s);
    const out = new Set();
    if (isSq(lastMove.from)) out.add(lastMove.from);
    if (isSq(lastMove.to)) out.add(lastMove.to);
    return out;
  }, [lastMove]);

  const safeHighlightSquares = useMemo(() => {
    if (!Array.isArray(highlightSquares)) return [];
    return [...new Set(highlightSquares.filter((s) => typeof s === 'string' && /^[a-h][1-8]$/.test(s)))];
  }, [highlightSquares]);

  const occupied = new Set(activePieces.map((p) => p.square));

  const normScale = board ? 8 / Math.max(board.size.x, board.size.z, 1e-6) : 1;
  const viewSize = board ? Math.max(board.size.x, board.size.z) * normScale : 8;
  const defaultZoom = viewSize * 1.35 + 2.5;
  const cameraY = viewSize * 0.85 + 2;
  const zoomEffective = zoom != null ? zoom : defaultZoom;

  const dollyBy = useCallback((factor) => {
    const c = controlsRef.current;
    if (!c) return;
    userZoomedRef.current = true;
    const cam = c.object;
    const dir = new THREE.Vector3().subVectors(cam.position, c.target);
    const d = THREE.MathUtils.clamp(dir.length() * factor, 1.5, Math.max(80, defaultZoom * 4));
    dir.setLength(d);
    cam.position.copy(c.target).add(dir);
    cam.updateProjectionMatrix();
  }, [defaultZoom]);

  const resetView = useCallback(() => {
    const c = controlsRef.current;
    if (!c) return;
    userZoomedRef.current = true;
    const cam = c.object;
    cam.position.set(0, cameraY, defaultZoom);
    c.target.set(0, 0, 0);
    cam.updateProjectionMatrix();
  }, [cameraY, defaultZoom]);

  const fitKey = `${model3d}|${board ? 'b' : 'nb'}`;

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        style={{ width: size || '100%', height: size || '100%', position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}
      >
        <Canvas
          shadows={!thumbnail}
          camera={{ position: [0, cameraY, zoomEffective], fov: 45 }}
          gl={{ antialias: !thumbnail }}
          dpr={thumbnail ? 1 : [1, 2]}
          frameloop={thumbnail ? 'demand' : 'always'}
        >
          <ambientLight intensity={0.9} color="#FFF4E0" />
          {thumbnail && <hemisphereLight args={['#FFF4E0', '#3a2c1c', 0.9]} />}
          <directionalLight
            position={[5, 10, 5]}
            intensity={1.4}
            color="#FFD580"
            castShadow={!thumbnail}
            shadow-mapSize={[2048, 2048]}
          />
          {!thumbnail && <Environment preset="forest" />}

          <group ref={boardGroupRef} rotation={[0, boardRotY, 0]} scale={normScale}>
            {clonedScene && <primitive object={clonedScene} />}

            {board && <BoardCatcher board={board} meshRef={catcherRef} onSquarePick={handleSquarePick} />}

            {!preview && board && (
              <>
                {[...lastMoveSquares].map((sq) =>
                  <SquareOverlay key={`lm-${sq}`} square={sq} board={board} color="#D4AF37" opacity={0.35} radius={0.46} height={0.02} />
                )}
                {checkSquare && (
                  <SquareOverlay square={checkSquare} board={board} color="#E84815" opacity={0.75} radius={0.46} height={0.028} shape="ring" />
                )}
                {selected && (
                  <SquareOverlay square={selected} board={board} color="#F0D060" opacity={0.6} radius={0.46} height={0.024} />
                )}
                {legalMoves.map((to) => (
                  <SquareOverlay
                    key={`legal-${to}`}
                    square={to}
                    board={board}
                    color={occupied.has(to) ? '#8B2500' : 'rgba(96,74,36,0.6)'}
                    opacity={0.85}
                    radius={occupied.has(to) ? 0.15 : 0.12}
                    height={0.032}
                    shape={occupied.has(to) ? 'ring' : 'plane'}
                  />
                ))}
                {safeHighlightSquares.map((sq) => (
                  <SquareOverlay key={`hl-${sq}`} square={sq} board={board} color="#8B2500" opacity={0.5} radius={0.46} height={0.02} shape="ring" />
                ))}
              </>
            )}

            {!preview && board && assignedPieces.map(({ pc, cluster }) => {
              const isDragging = drag?.from === pc.square;
              return (
                <group
                  key={cluster.square}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSquarePick(pc.square);
                  }}
                  onPointerDown={(e) => startDrag(pc.square, e)}
                >
                  <ModelPiece cluster={cluster} square={pc.square} board={board} opacity={isDragging ? 0.4 : 1} />
                </group>
              );
            })}

            {!preview && board && drag && hoverSquare && hoverSquare !== drag.from && (() => {
              const found = assignedPieces.find((a) => a.pc.square === drag.from);
              if (!found) return null;
              return (
                <ModelPiece cluster={found.cluster} square={hoverSquare} board={board} opacity={0.55} lift={0.12} />
              );
            })()}
          </group>

          {!thumbnail && (
            <OrbitControls
              ref={controlsRef}
              minPolarAngle={0.25}
              maxPolarAngle={Math.PI / 2.15}
              minDistance={1.5}
              maxDistance={Math.max(80, zoomEffective * 4)}
              zoomSpeed={1.2}
              target={[0, 0, 0]}
              enablePan={false}
              enableZoom={true}
              onStart={() => { userZoomedRef.current = true; }}
            />
          )}
          {!thumbnail && (
            <AutoFit
              controlsRef={controlsRef}
              target={zoom != null ? zoom : defaultZoom}
              fitKey={fitKey}
              cancelledRef={userZoomedRef}
            />
          )}
          {!thumbnail && <DragBridge host={dragHost} />}
        </Canvas>

        {!thumbnail && !preview && (
          <div style={{ position: 'absolute', right: 10, bottom: 10, zIndex: 5, display: 'flex', gap: 6 }}>
            <button className="interactive" aria-label="Zoom out" title="Zoom out" onClick={() => dollyBy(1.25)} style={zoomBtnStyle}>−</button>
            <button className="interactive" aria-label="Reset view" title="Reset view" onClick={resetView} style={zoomBtnStyle}>⛶</button>
            <button className="interactive" aria-label="Zoom in" title="Zoom in" onClick={() => dollyBy(0.8)} style={zoomBtnStyle}>+</button>
          </div>
        )}

        {!preview && !playable && (
          <div style={overlayStyle}>
            <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>⚠️</div>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>This 3D model isn't playable</div>
            <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '12px' }}>
              Its pieces can't be individually moved.
            </div>
            {onFallbackTo2D && (
              <button className="btn-neon interactive" onClick={onFallbackTo2D} style={{ padding: '8px 14px', fontSize: '0.7rem' }}>
                Switch to 2D board
              </button>
            )}
          </div>
        )}

        {!preview && promotion && (
          <div
            role="dialog"
            aria-label="Choose promotion piece"
            style={{
              position: 'absolute', inset: 0, zIndex: 5, display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: '10px', padding: '16px',
              background: 'rgba(15,8,5,0.45)',
            }}
          >
            {['q', 'r', 'b', 'n'].map((p) => (
              <button
                key={p}
                className="promotion-btn interactive"
                style={{
                  width: 54, height: 54, fontSize: '1.9rem', borderRadius: 8,
                  border: '1.5px solid var(--royal-gold, #D4AF37)',
                  background: 'var(--lab-panel)', color: 'var(--lab-ink)',
                }}
                onClick={() => { makeMove(promotion.from, promotion.to, p); setPromotion(null); }}
              >
                {P_MODES[p][playerColor === 'white' ? 'w' : 'b']}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const zoomBtnStyle = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: '1px solid rgba(212, 175, 55, 0.45)',
  background: 'var(--lab-panel)',
  color: 'var(--royal-gold, #D4AF37)',
  fontSize: '1.05rem',
  lineHeight: 1,
  cursor: 'pointer',
};

const overlayStyle = {
  position: 'absolute',
  inset: 0,
  zIndex: 4,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: '16px',
  background: 'rgba(15,8,5,0.72)',
  color: '#F5EDD8',
  fontFamily: "'Cinzel', serif",
  borderRadius: 'var(--radius-lg)',
  pointerEvents: 'auto',
};