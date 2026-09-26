export const BOARDS_2D = [
  { id: 'Glass and Marble',  label: 'Glass & Marble',  file: 'Glass and Marble 512x552.png' },
  { id: 'Glass and Stone',   label: 'Glass & Stone',   file: 'Glass and Stone 512x552.png' },
  { id: 'Glass and Wood',    label: 'Glass & Wood',    file: 'Glass and Wood 512x552.png' },
  { id: 'Marble and Marble', label: 'Marble & Marble', file: 'Marble and Marble 512x552.png' },
  { id: 'Marble and Stone',  label: 'Marble & Stone',  file: 'Marble and Stone 512x552.png' },
  { id: 'Marble and Wood',   label: 'Marble & Wood',   file: 'Marble and Wood 512x552.png' },
  { id: 'Plastic and Marble',label: 'Plastic & Marble',file: 'Plastic and Marble 512x552.png' },
  { id: 'Plastic and Metal', label: 'Plastic & Metal', file: 'Plastic and Metal 512x552.png' },
  { id: 'Plastic and Wood',  label: 'Plastic & Wood',  file: 'Plastic and Wood 512x552.png' },
  { id: 'Wood and Marble',   label: 'Wood & Marble',   file: 'Wood and Marble 512x552.png' },
  { id: 'Wood and Metal',    label: 'Wood & Metal',    file: 'Wood and Metal 512x552.png' },
  { id: 'Wood and Wood',     label: 'Wood & Wood',     file: 'Wood and Wood 512x552.png' },
];

export const MODELS_3D = [
  { id: 'chess (1).glb', label: 'Royal Copper & Shedua', desc: 'Luxury wood set with copper and gold trim' },
  { id: 'chess (3).glb', label: 'Classic Tournament', desc: 'Clean traditional tournament Staunton' },
  { id: 'chess.glb', label: 'Bavarian Spruce', desc: 'Warm hand-crafted spruce wood set' },
  { id: 'chess_board (3).glb', label: 'Crystal Glass', desc: 'Modern transparent glass set' },
  { id: 'low_poly_chess_-_chess_board.glb', label: 'Low Poly Atelier', desc: 'Stylized low-poly wooden set' },
  { id: 'replica_lewis_chess_pieces_on_chessboard.glb', label: 'Lewis Norse Replica', desc: 'Historic Isle of Lewis chessmen' },
];

export const REMOVED_MODELS_3D = [
  'cartoon_chess_set.glb',
  'chess (2).glb',
  'chess (4).glb',
  'chess_board (1).glb',
  'chess_board (2).glb',
  'chess_board.glb',
  'chess_set (1).glb',
  'chess_set.glb',
  'chinese_chess.glb',
  'retropc_chess.glb',
  'wizards_chess.glb',
  'wooden_chess (1).glb',
  'wooden_chess_set.glb',
];

export const DEFAULT_MODEL_3D = 'low_poly_chess_-_chess_board.glb';

export const PREVIEW_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export { MODEL_3D_OVERRIDES } from './analyzeModel.js';

export const PIECES_2D = [
  { id: 'Marble 1',  label: 'Marble',  fileBlack: 'Black - Marble 1 128x128.png',  fileWhite: 'White - Marble 1 128x128.png' },
  { id: 'Plastic 1', label: 'Plastic', fileBlack: 'Black - Plastic 1 128x128.png', fileWhite: 'White - Plastic 1 128x128.png' },
  { id: 'Rust 1',    label: 'Rust',    fileBlack: 'Black - Rust 1 128x128.png',    fileWhite: 'White - Rust 1 128x128.png' },
  { id: 'Wood 1',    label: 'Wood',    fileBlack: 'Black - Wood 1 128x128.png',    fileWhite: 'White - Wood 1 128x128.png' },
];

export const PIECE_SPRITE_MAP = {
  n: [0, 1],
  b: [1, 1],
  k: [0, 2],
  q: [1, 2],
  r: [3, 2],
  p: [0, 3],
};

export function getBoardUrl(style, boardVariant) {
  if (style !== '2d') return '';
  const board = BOARDS_2D.find((b) => b.id === boardVariant) ?? BOARDS_2D[0];
  return `/chess-themes/2d/boards/${encodeURIComponent(board.file)}`;
}

export function getTransparentPieceCellUrl(pieceVariant, color, type) {
  const piece = PIECES_2D.find((p) => p.id === pieceVariant) ?? PIECES_2D[0];
  const slug = piece.id.toLowerCase().replace(/\s+/g, '-');
  const t = (type || 'p').toLowerCase();
  const safe = PIECE_SPRITE_MAP[t] ? t : 'p';
  const dir = color === 'black' ? 'black' : 'white';
  return `/chess-themes/2d/pieces-transparent/${dir}/${encodeURIComponent(slug)}/${safe}.png`;
}
