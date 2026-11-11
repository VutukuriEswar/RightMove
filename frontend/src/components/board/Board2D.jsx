import React, { useEffect, useRef, memo, useState, useCallback, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { motion } from 'framer-motion';
import { useBoardThemeStore } from '../../store/boardThemeStore';
import { getTransparentPieceCellUrl } from '../../lib/boardThemes';
import { getBoardTiles, getSquareBaseColours } from '../../lib/boardTexture';

function findCheckSquares(chess) {
  if (!chess.inCheck()) return { kingSquare: null, checkerSquares: [], isCheckmate: false, kingColor: null, checkerPieceName: '' };

  const turn  = chess.turn();
  const board = chess.board();
  const FILES = 'abcdefgh';

  let kingSquare = null;
  outer: for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === turn) {
        kingSquare = FILES[c] + (8 - r);
        break outer;
      }
    }
  }

  if (!kingSquare) return { kingSquare: null, checkerSquares: [], isCheckmate: false, kingColor: turn, checkerPieceName: '' };

  const checkerSquares = [];
  try {
    const fenParts = chess.fen().split(' ');
    fenParts[1] = turn === 'w' ? 'b' : 'w';
    fenParts[3] = '-';
    const tmp = new Chess(fenParts.join(' '));
    tmp.moves({ verbose: true }).forEach((m) => {
      if (m.to === kingSquare && !checkerSquares.includes(m.from)) {
        checkerSquares.push(m.from);
      }
    });
  } catch (_) {
  }

  const pieceNames = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
  let checkerPieceName = 'Piece';
  if (checkerSquares.length > 0) {
    const cp = chess.get(checkerSquares[0]);
    if (cp && pieceNames[cp.type]) {
      const colName = cp.color === 'w' ? 'White' : 'Black';
      checkerPieceName = `${colName} ${pieceNames[cp.type]}`;
    }
  }

  return {
    kingSquare,
    checkerSquares,
    isCheckmate: chess.isCheckmate(),
    kingColor: turn,
    checkerPieceName,
  };
}

function buildCustomPieces(pieceVariant) {
  const pieces = {};
  const pieceTypes = ['wP','wN','wB','wR','wQ','wK','bP','bN','bB','bR','bQ','bK'];
  pieceTypes.forEach((code) => {
    const color = code[0] === 'w' ? 'white' : 'black';
    const src = getTransparentPieceCellUrl(pieceVariant, color, code[1]);

    pieces[code] = () => (
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
      />
    );
  });
  return pieces;
}

const Board2D = memo(function Board2D({
  fen,
  playerColor = 'white',
  flipped = false,
  onMove,
  disabled = false,
  lastMove = null,
  highlightSquares = [],
  arrows = null,
  id = 'mainBoard',
  framed = true,
  isFlipping = false,
}) {
  const containerRef = useRef(null);
  const safeFen = useMemo(() => {
    try {
      new Chess(fen);
      return fen;
    } catch (_) {
      return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    }
  }, [fen]);
  const chessRef     = useRef(new Chess(safeFen));
  const [frameSize, setFrameSize] = useState(null);
  const [selectedSquare, setSelectedSquare]     = useState(null);
  const [legalMoveSquares, setLegalMoveSquares] = useState({});
  const [promotionDialog, setPromotionDialog]   = useState(null);

  const { boardVariant, pieceVariant } = useBoardThemeStore();

  const pieces = useMemo(
    () => buildCustomPieces(pieceVariant),
    [pieceVariant]
  );

  const { darkCol, lightCol } = useMemo(
    () => getSquareBaseColours(boardVariant),
    [boardVariant]
  );
  const [boardTiles, setBoardTiles] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setBoardTiles(null);
    getBoardTiles(boardVariant).then((tiles) => {
      if (!cancelled && tiles) setBoardTiles(tiles);
    });
    return () => { cancelled = true; };
  }, [boardVariant]);

  const darkSquareStyle = boardTiles?.darkTile
    ? {
        backgroundColor: darkCol,
        backgroundImage: `url("${boardTiles.darkTile}")`,
        backgroundSize: 'cover',
      }
    : { backgroundColor: darkCol };
  const lightSquareStyle = boardTiles?.lightTile
    ? {
        backgroundColor: lightCol,
        backgroundImage: `url("${boardTiles.lightTile}")`,
        backgroundSize: 'cover',
      }
    : { backgroundColor: lightCol };

  const [checkToast, setCheckToast] = useState(null);
  const toastTimerRef = useRef(null);

  const showCheckToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setCheckToast(Date.now());
    toastTimerRef.current = setTimeout(() => setCheckToast(null), 3200);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const size = Math.floor(Math.min(width, height));
      if (size > 80) setFrameSize(size);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const currentChess = useMemo(() => {
    try {
      return new Chess(safeFen);
    } catch (_) {
      return new Chess();
    }
  }, [safeFen]);
  chessRef.current = currentChess;

  useEffect(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setCheckToast(null);
  }, [safeFen]);

  const { kingSquare, checkerSquares, isCheckmate, kingColor, checkerPieceName } = findCheckSquares(currentChess);

  const squareStyles = {};

  if (lastMove?.from && lastMove?.to) {
    squareStyles[lastMove.from] = { background: 'rgba(212, 175, 55, 0.40)' };
    squareStyles[lastMove.to]   = { background: 'rgba(212, 175, 55, 0.50)' };
  }

  if (kingSquare) {
    if (isCheckmate) {
      squareStyles[kingSquare] = {
        background: 'radial-gradient(circle, rgba(231,76,60,0.95) 0%, rgba(139,0,0,0.85) 60%, rgba(139,0,0,0.4) 90%)',
        boxShadow: 'inset 0 0 18px rgba(255, 30, 30, 0.95), 0 0 16px rgba(255, 30, 30, 0.9)',
        outline: '3.5px solid #FF3B30',
        outlineOffset: '-3.5px',
        borderRadius: '4px',
        zIndex: 5,
      };
    } else {
      squareStyles[kingSquare] = {
        background: 'radial-gradient(circle, rgba(220,20,20,0.85) 0%, rgba(139,37,0,0.5) 60%, transparent 85%)',
        boxShadow: 'inset 0 0 12px rgba(220, 20, 20, 0.75)',
        outline: '2.5px solid rgba(220, 20, 20, 0.85)',
        outlineOffset: '-2.5px',
        borderRadius: '4px',
      };
    }
  }

  checkerSquares.forEach((sq) => {
    squareStyles[sq] = {
      ...(squareStyles[sq] || {}),
      background: isCheckmate
        ? 'radial-gradient(circle, rgba(212,175,55,0.95) 0%, rgba(166,124,82,0.65) 65%, transparent 85%)'
        : 'radial-gradient(circle, rgba(212,175,55,0.7) 0%, rgba(166,124,82,0.4) 65%, transparent 85%)',
      outline: isCheckmate ? '3.5px solid #D4AF37' : '2.5px solid rgba(212,175,55,0.85)',
      outlineOffset: '-2.5px',
      boxShadow: isCheckmate ? 'inset 0 0 16px rgba(212, 175, 55, 0.95), 0 0 12px rgba(212, 175, 55, 0.8)' : undefined,
      borderRadius: '4px',
      zIndex: 4,
    };
  });

  Object.assign(squareStyles, legalMoveSquares);

  const safeHighlights = Array.isArray(highlightSquares) ? highlightSquares : [];
  safeHighlights.forEach((sq) => {
    if (typeof sq !== 'string' || !/^[a-h][1-8]$/.test(sq)) return;
    squareStyles[sq] = {
      ...squareStyles[sq],
      border: '2.5px solid var(--royal-crimson, #8B2500)',
      borderRadius: '3px',
    };
  });

  if (selectedSquare) {
    squareStyles[selectedSquare] = {
      ...squareStyles[selectedSquare],
      background: 'rgba(212, 175, 55, 0.55)',
    };
  }

  function handleSquareClick({ piece, square }) {
    if (disabled) return;
    const chess = chessRef.current;

    if (selectedSquare && legalMoveSquares[square]) {
      const movingPiece = chess.get(selectedSquare);
      const isPromotion =
        movingPiece?.type === 'p' &&
        ((movingPiece.color === 'w' && square[1] === '8') ||
         (movingPiece.color === 'b' && square[1] === '1'));

      if (isPromotion) {
        setPromotionDialog({ from: selectedSquare, to: square });
      } else {
        makeMove(selectedSquare, square);
      }
      return;
    }

    const clickedPiece = chess.get(square);
    if (clickedPiece && clickedPiece.color === (playerColor === 'white' ? 'w' : 'b')) {
      setSelectedSquare(square);
      const moves = chess.moves({ square, verbose: true });
      const dots  = {};
      moves.forEach((m) => {
        dots[m.to] = chess.get(m.to)
          ? {
              background: 'radial-gradient(circle, rgba(139,37,0,0.55) 55%, transparent 60%)',
              borderRadius: '50%',
            }
          : {
              background: 'radial-gradient(circle, rgba(80,40,10,0.30) 28%, transparent 33%)',
              borderRadius: '50%',
            };
      });
      setLegalMoveSquares(dots);

      if (chess.inCheck() && moves.length === 0) {
        showCheckToast();
      }
    } else {
      setSelectedSquare(null);
      setLegalMoveSquares({});
    }
  }

  function handlePieceDrop({ sourceSquare, targetSquare }) {
    if (disabled) return false;
    const piece = chessRef.current.get(sourceSquare);
    const own = playerColor === 'white' ? 'w' : 'b';
    if (!piece || piece.color !== own) return false;
    return makeMove(sourceSquare, targetSquare);
  }

  function makeMove(from, to, promotion = 'q') {
    const chess      = chessRef.current;
    const wasInCheck = chess.inCheck();
    let result = null;
    try {
      result = chess.move({ from, to, promotion });
    } catch (_) {
      result = null;
    }

    if (!result) {
      if (wasInCheck) showCheckToast();
      return false;
    }

    chess.undo();

    const uci = `${from}${to}${result.promotion ? promotion : ''}`;
    onMove?.(uci);
    setSelectedSquare(null);
    setLegalMoveSquares({});
    return true;
  }

  function handlePromotion(piece) {
    if (!promotionDialog) return;
    makeMove(promotionDialog.from, promotionDialog.to, piece);
    setPromotionDialog(null);
  }

  const boardArrows = useMemo(() => {
    if (!Array.isArray(arrows)) return null;
    const mapped = arrows.map((a) => {
      if (a && typeof a.startSquare === 'string' && typeof a.endSquare === 'string') return a;
      if (a && typeof a.from === 'string' && typeof a.to === 'string') {
        return { startSquare: a.from, endSquare: a.to, color: a.color || '#D4AF37' };
      }
      return null;
    }).filter(Boolean);
    return mapped.length > 0 ? mapped : null;
  }, [arrows]);

  const orientation = flipped
    ? playerColor === 'white' ? 'black' : 'white'
    : playerColor;

  return (
    <motion.div
      ref={containerRef}
      className={framed ? 'board2d-outer' : 'board2d-outer board2d-outer--bare'}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <div
        className={framed ? 'board2d-frame' : 'board2d-frame board2d-frame--bare'}
        style={frameSize ? { width: frameSize, height: frameSize } : undefined}
      >
        <Chessboard
          options={{
            id,
            position: safeFen,
            boardOrientation: orientation,
            onSquareClick: handleSquareClick,
            onPieceDrop: handlePieceDrop,
            squareStyles: squareStyles,
            showNotation: false,
            allowDragging: !disabled,
            ...(boardArrows ? { arrows: boardArrows, allowDrawingArrows: false } : {}),
            boardStyle: {
              borderRadius: '4px',
              boxShadow: 'none',
            },
            darkSquareStyle:  darkSquareStyle,
            lightSquareStyle: lightSquareStyle,
            animationDurationInMs: isFlipping ? 0 : 300,
            pieces,
          }}
        />

        {promotionDialog && (
          <div className="promotion-dialog" role="dialog" aria-label="Choose promotion piece">
            {['q', 'r', 'b', 'n'].map((p) => (
              <button
                key={p}
                className="promotion-btn interactive"
                onClick={() => handlePromotion(p)}
              >
                {playerColor === 'white'
                  ? { q: '♛', r: '♜', b: '♝', n: '♞' }[p]
                  : { q: '♕', r: '♖', b: '♗', n: '♘' }[p]}
              </button>
            ))}
          </div>
        )}

        {checkToast && (
          <div className="check-toast" key={checkToast} role="alert" aria-live="assertive">
            <span className="check-toast-icon">⚠</span>
            <span>Your King is in check — you must defend it!</span>
          </div>
        )}

        {kingSquare && (
          <div className={`board-check-strip${isCheckmate ? ' is-checkmate' : ''}`} role="alert" aria-live="polite">
            <span className="board-check-strip-icon">{isCheckmate ? '👑' : '⚠️'}</span>
            <span>
              {isCheckmate ? (
                <>
                  <strong>Checkmate!</strong> {kingColor === 'w' ? 'White' : 'Black'} King on {kingSquare} checkmated by {checkerPieceName}{checkerSquares[0] ? ` on ${checkerSquares[0]}` : ''}
                </>
              ) : (
                <>
                  <strong>Check!</strong> {kingColor === 'w' ? 'White' : 'Black'} King on {kingSquare} checked by {checkerPieceName}{checkerSquares[0] ? ` on ${checkerSquares[0]}` : ''}
                </>
              )}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
});

export default Board2D;
