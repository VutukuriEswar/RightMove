import { getBoardUrl } from './boardThemes';

export const SQUARE_COLOURS = {
  Glass:   { dark: '#7DB5C4', light: '#B8DDE8' },
  Marble:  { dark: '#9E8B7C', light: '#E8DDD0' },
  Plastic: { dark: '#6B9CA8', light: '#C4DCE2' },
  Wood:    { dark: '#7B4F2E', light: '#C49A6C' },
  Stone:   { dark: '#6B6B6B', light: '#B0AEAA' },
  Metal:   { dark: '#5A7080', light: '#9EB5C0' },
};

export function getSquareBaseColours(boardVariant) {
  const parts = boardVariant ? boardVariant.split(' and ') : [];
  const darkKey = parts[0] || 'Wood';
  const lightKey = parts[1] || 'Marble';
  return {
    darkKey,
    lightKey,
    darkCol: (SQUARE_COLOURS[darkKey] || SQUARE_COLOURS.Wood).dark,
    lightCol: (SQUARE_COLOURS[lightKey] || SQUARE_COLOURS.Marble).light,
  };
}

const _tileCache = new Map();

function _luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function _loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const TILE_PX = 256;
const TILE_SATURATION = 1.35;
const TILE_CONTRAST = 1.06;

function _boostTileVividness(tctx, size, saturation, contrast) {
  let imageData;
  try {
    imageData = tctx.getImageData(0, 0, size, size);
  } catch (_) {
    return;
  }
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let nr = gray + (r - gray) * saturation;
    let ng = gray + (g - gray) * saturation;
    let nb = gray + (b - gray) * saturation;
    nr = (nr - 128) * contrast + 128;
    ng = (ng - 128) * contrast + 128;
    nb = (nb - 128) * contrast + 128;
    d[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
    d[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
    d[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
  }
  try {
    tctx.putImageData(imageData, 0, 0);
  } catch (_) {
  }
}

function _extractTiles(img) {
  const BOARD_PX = 512;
  const CELL = 64;
  const canvas = document.createElement('canvas');
  canvas.width = BOARD_PX;
  canvas.height = BOARD_PX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const srcBoardH = img.naturalHeight >= 540 ? (512 / 552) * img.naturalHeight : img.naturalHeight;
  ctx.drawImage(img, 0, 0, img.naturalWidth, srcBoardH, 0, 0, BOARD_PX, BOARD_PX);

  let boardData;
  try {
    boardData = ctx.getImageData(0, 0, BOARD_PX, BOARD_PX);
  } catch (_) {
    return null;
  }

  const sample = (cx, cy) => {
    const idx = (cy * BOARD_PX + cx) * 4;
    return [boardData.data[idx], boardData.data[idx + 1], boardData.data[idx + 2]];
  };
  const cA = sample(CELL / 2, CELL / 2);
  const cB = sample(CELL + CELL / 2, CELL / 2);
  const lumA = _luminance(...cA);
  const lumB = _luminance(...cB);
  const darkOrigin = lumA < lumB ? [0, 0] : [CELL, 0];
  const lightOrigin = lumA < lumB ? [CELL, 0] : [0, 0];

  const makeTile = ([sx, sy]) => {
    const tile = document.createElement('canvas');
    tile.width = TILE_PX;
    tile.height = TILE_PX;
    const tctx = tile.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(canvas, sx, sy, CELL, CELL, 0, 0, TILE_PX, TILE_PX);
    _boostTileVividness(tctx, TILE_PX, TILE_SATURATION, TILE_CONTRAST);
    try {
      return tile.toDataURL('image/png');
    } catch (_) {
      return null;
    }
  };

  const darkTile = makeTile(darkOrigin);
  const lightTile = makeTile(lightOrigin);
  if (!darkTile || !lightTile) return null;
  return { darkTile, lightTile };
}

export function getBoardTiles(boardVariant) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  const key = boardVariant || 'Wood and Marble';
  if (_tileCache.has(key)) return _tileCache.get(key);
  const url = getBoardUrl('2d', key);
  const p = _loadImage(url)
    .then((img) => _extractTiles(img))
    .catch(() => null);
  _tileCache.set(key, p);
  return p;
}
