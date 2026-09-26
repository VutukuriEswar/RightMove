import * as THREE from 'three';

export const MODEL_BOARD_HINTS = {
  'low_poly_chess_-_chess_board.glb': 'Chessboard',
};

export const MODEL_3D_OVERRIDES = {
  'low_poly_chess_-_chess_board.glb': {
    whiteAtZ0: false,
    invertX: false,
  },
};

const GENERIC_BOARD_NAME_HINTS = [
  'chessboard',
  'chess_board',
  'chess board',
  'qipan',
  'boardwood',
];

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const HOME_TYPES = { a: 'r', b: 'n', c: 'b', d: 'q', e: 'k', f: 'b', g: 'n', h: 'r' };

const WHITE_SET = new Set();
const BLACK_SET = new Set();
FILES.forEach((f, i) => {
  const letter = f;
  WHITE_SET.add(`${letter}1`);
  WHITE_SET.add(`${letter}2`);
  BLACK_SET.add(`${letter}7`);
  BLACK_SET.add(`${letter}8`);
});
const HOME_RANK = { w: 1, b: 8 };
const PAWN_RANK  = { w: 2, b: 7 };

function averageLightness(meshes) {
  if (!meshes.length) return 0;
  let sum = 0;
  let n = 0;
  meshes.forEach((m) => {
    const material = m.obj?.material ?? m.material;
    if (!material) return;
    const mats = Array.isArray(material) ? material : [material];
    mats.forEach((mat) => {
      let lightness;
      if (mat.map) {
        lightness = 0.5;
      } else {
        const col = mat.color || new THREE.Color(1, 1, 1);
        lightness = col.getHSL({ h: 0, s: 0, l: 0 }).l;
      }
      sum += lightness;
      n += 1;
    });
  });
  return n ? sum / n : 0;
}

export function analyzeModel(scene, modelId) {
  if (!scene) return null;

  scene.updateMatrixWorld(true);

  const override = MODEL_3D_OVERRIDES?.[modelId];
  if (override) {
    try {
      const viaOverride = analyzeWithOverride(scene, override);
      if (viaOverride) return viaOverride;
    } catch (_) {
    }
  }

  const meshes = [];
  scene.traverse((child) => {
    if (child.isMesh && child.visible) {
      const box = new THREE.Box3().setFromObject(child);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      meshes.push({ obj: child, box, size, center });
    }
  });
  if (!meshes.length) return { playable: false, board: null, pieces: [], pieceCount: 0, clusterCount: 0 };

  const hintName = MODEL_BOARD_HINTS[modelId];
  const nameOf = (m) => m.obj.name || '';
  const parentNameOf = (m) => m.obj.parent?.name || '';
  let boardEntry = null;
  if (hintName) {
    boardEntry =
      meshes.find((m) => nameOf(m) === hintName || parentNameOf(m) === hintName) ||
      meshes.find(
        (m) =>
          nameOf(m).toLowerCase() === hintName.toLowerCase() ||
          parentNameOf(m).toLowerCase() === hintName.toLowerCase()
      ) ||
      meshes.find(
        (m) =>
          nameOf(m).toLowerCase().includes(hintName.toLowerCase()) ||
          parentNameOf(m).toLowerCase().includes(hintName.toLowerCase()) ||
          hintName.toLowerCase().includes(nameOf(m).toLowerCase())
      ) ||
      null;
  }
  if (!boardEntry) {
    let bestGeneric = null;
    let bestGenericArea = 0;
    meshes.forEach((m) => {
      const hay = `${nameOf(m)} ${parentNameOf(m)}`.toLowerCase();
      if (!GENERIC_BOARD_NAME_HINTS.some((h) => hay.includes(h))) return;
      const area = m.size.x * m.size.z;
      if (area > bestGenericArea) {
        bestGenericArea = area;
        bestGeneric = m;
      }
    });
    boardEntry = bestGeneric;
  }
  if (!boardEntry) {
    const sceneBox = new THREE.Box3().setFromObject(scene);
    const floorY = sceneBox.min.y;
    const cands = [];
    meshes.forEach((m) => {
      if (m.size.x <= 0 || m.size.z <= 0) return;
      if (m.center.y - m.size.y / 2 > floorY + m.size.y * 0.6) return;
      const aspect = m.size.x / m.size.z;
      cands.push({
        m,
        area: m.size.x * m.size.z,
        square: aspect >= 0.66 && aspect <= 1.5,
      });
    });
    cands.sort((a, b) => b.area - a.area);
    const maxArea = cands.length ? cands[0].area : 0;
    const nearSquare = cands.find((c) => c.square && c.area >= maxArea * 0.4);
    boardEntry = (nearSquare || cands[0] || {}).m || null;
  }
  if (!boardEntry) return { playable: false, board: null, pieces: [], pieceCount: 0, clusterCount: 0 };

  const boardBox = boardEntry.box;
  const boardMinX = boardBox.min.x;
  const boardMinZ = boardBox.min.z;
  const boardW = boardBox.getSize(new THREE.Vector3()).x;
  const boardD = boardBox.getSize(new THREE.Vector3()).z;
  const cellX = boardW / 8;
  const cellZ = boardD / 8;
  const boardFloorY = boardBox.max.y;

  function buildCandidate(useFloor) {
    const map = new Map();
    const toIx = (x) =>
      useFloor
        ? Math.floor((x - boardMinX) / cellX)
        : Math.round((x - boardMinX) / cellX);
    const toIz = (z) =>
      useFloor
        ? Math.floor((z - boardMinZ) / cellZ)
        : Math.round((z - boardMinZ) / cellZ);
    meshes.forEach((m) => {
      const ix = toIx(m.center.x);
      const iz = toIz(m.center.z);
      if (ix < 0 || ix > 7 || iz < 0 || iz > 7) return;
      if (m.center.y < boardFloorY - cellX * 0.4) return;
      const key = `${ix},${iz}`;
      if (!map.has(key)) map.set(key, { ix, iz, meshes: [], center: m.center });
      map.get(key).meshes.push(m);
    });

    const sideA = [];
    const sideB = [];
    map.forEach((cl) => {
      if (cl.iz === 0) sideA.push(cl);
      if (cl.iz === 7) sideB.push(cl);
    });

    let whiteAtZ0;
    const override = MODEL_3D_OVERRIDES?.[modelId];
    if (override && typeof override.whiteAtZ0 === 'boolean') {
      whiteAtZ0 = override.whiteAtZ0;
    } else {
      const lightnessA = averageLightness(sideA.flatMap((c) => c.meshes));
      const lightnessB = averageLightness(sideB.flatMap((c) => c.meshes));
      whiteAtZ0 = lightnessA >= lightnessB;
    }

    const pieces = [];
    const invertX = override?.invertX ?? !whiteAtZ0;

    map.forEach((cl) => {
      const ix = cl.ix;
      const iz = cl.iz;
      const file = FILES[invertX ? 7 - ix : ix];
      const rank = whiteAtZ0 ? iz + 1 : 8 - iz;
      const color = rank <= 4 ? 'w' : 'b';
      if (rank === HOME_RANK[color]) {
        pieces.push({
          square: `${file}${rank}`,
          color,
          type: HOME_TYPES[file],
          origin: cl.center.clone(),
          meshes: cl.meshes,
          ix,
          iz,
        });
      } else if (rank === PAWN_RANK[color]) {
        pieces.push({
          square: `${file}${rank}`,
          color,
          type: 'p',
          origin: cl.center.clone(),
          meshes: cl.meshes,
          ix,
          iz,
        });
      }
    });
    return { map, pieces, whiteAtZ0, invertX };
  }

  const roundCand = buildCandidate(false);
  const floorCand = buildCandidate(true);
  const score = (cand) => {
    const covered = new Set(cand.pieces.map((p) => p.square));
    let s = 0;
    FILES.forEach((f) => {
      [1, 2, 7, 8].forEach((r) => {
        if (covered.has(`${f}${r}`)) s += 1;
      });
    });
    return s;
  };
  const best = score(floorCand) > score(roundCand) ? floorCand : roundCand;
  const { pieces, whiteAtZ0, invertX } = best;
  const clusterCount = best.map.size;

  const board = {
    minX: boardMinX,
    minZ: boardMinZ,
    cellX,
    cellZ,
    floorY: boardFloorY,
    whiteAtZ0,
    invertX,
    size: boardBox.getSize(new THREE.Vector3()),
  };

  const covered = new Map(pieces.map((p) => [p.square, p]));
  const expected = new Map();
  FILES.forEach((f) => {
    [1, 2, 7, 8].forEach((r) => {
      const color = r <= 2 ? 'w' : 'b';
      expected.set(`${f}${r}`, {
        color,
        type: r === HOME_RANK[color] ? HOME_TYPES[f] : 'p',
      });
    });
  });

  let valid = pieces.length === 32;
  if (valid) {
    expected.forEach((exp, sq) => {
      const got = covered.get(sq);
      if (!got || got.color !== exp.color || got.type !== exp.type) valid = false;
    });
  }

  return { playable: valid, board, pieces, pieceCount: pieces.length, clusterCount };
}

function meshesUnder(scene, name) {
  if (!name || typeof scene.getObjectByName !== 'function') return null;
  const node = scene.getObjectByName(name);
  if (!node) return null;
  const out = [];
  node.traverse((c) => {
    if (c.isMesh) {
      const box = new THREE.Box3().setFromObject(c);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      out.push({ obj: c, box, size, center });
    }
  });
  return out.length ? out : null;
}

function analyzeWithOverride(scene, override) {
  const boardMeshes = meshesUnder(scene, override.board);
  if (!boardMeshes) return null;
  const boardBox = new THREE.Box3();
  boardMeshes.forEach((m) => boardBox.union(m.box));
  const boardSize = boardBox.getSize(new THREE.Vector3());
  if (boardSize.x <= 0 || boardSize.z <= 0) return null;
  const board = {
    minX: boardBox.min.x,
    minZ: boardBox.min.z,
    cellX: boardSize.x / 8,
    cellZ: boardSize.z / 8,
    floorY: boardBox.max.y,
    whiteAtZ0: true,
    size: boardSize,
  };

  const resolved = [];
  const entries = override.pieces || {};
  Object.keys(entries).forEach((square) => {
    if (!/^[a-h][1-8]$/.test(square)) return;
    const rank = +square[1];
    const color = rank <= 2 ? 'w' : 'b';
    const type =
      rank === HOME_RANK[color] ? HOME_TYPES[square[0]]
      : rank === PAWN_RANK[color] ? 'p'
      : null;
    if (!type) return;
    const names = Array.isArray(entries[square]) ? entries[square] : [entries[square]];
    const meshes = [];
    names.forEach((n) => {
      const found = meshesUnder(scene, n);
      if (found) meshes.push(...found);
    });
    if (!meshes.length) return;
    resolved.push({ square, color, type, meshes, origin: meshes[0].center.clone() });
  });

  const covered = new Map(resolved.map((p) => [p.square, p]));
  let valid = resolved.length === 32;
  if (valid) {
    FILES.forEach((f) => {
      [1, 2, 7, 8].forEach((r) => {
        const color = r <= 2 ? 'w' : 'b';
        const expType = r === HOME_RANK[color] ? HOME_TYPES[f] : 'p';
        const got = covered.get(`${f}${r}`);
        if (!got || got.color !== color || got.type !== expType) valid = false;
      });
    });
  }
  if (!valid) {
    return { playable: false, board, pieces: [], pieceCount: resolved.length, clusterCount: resolved.length };
  }

  const avgCenter = (p) => {
    const v = new THREE.Vector3();
    p.meshes.forEach((m) => v.add(m.center));
    return v.multiplyScalar(1 / p.meshes.length);
  };
  const errorFor = (whiteAtZ0) => {
    let err = 0;
    resolved.forEach((p) => {
      const fi = FILES.indexOf(p.square[0]);
      const rank = +p.square[1];
      const ix = whiteAtZ0 ? fi : 7 - fi;
      const iz = whiteAtZ0 ? rank - 1 : 7 - (rank - 1);
      const px = board.minX + (ix + 0.5) * board.cellX;
      const pz = board.minZ + (iz + 0.5) * board.cellZ;
      const c = avgCenter(p);
      err += Math.abs(c.x - px) + Math.abs(c.z - pz);
    });
    return err;
  };
  const whiteAtZ0 = errorFor(false) < errorFor(true) ? false : true;
  const invertX = override?.invertX ?? !whiteAtZ0;
  board.whiteAtZ0 = whiteAtZ0;
  board.invertX = invertX;

  resolved.forEach((p) => {
    const fi = FILES.indexOf(p.square[0]);
    const rank = +p.square[1];
    p.ix = invertX ? 7 - fi : fi;
    p.iz = whiteAtZ0 ? rank - 1 : 7 - (rank - 1);
  });

  return { playable: true, board, pieces: resolved, pieceCount: 32, clusterCount: 32 };
}
