export function evalToWinProbabilities(evalCp) {
  if (evalCp == null || Number.isNaN(Number(evalCp))) {
    return { white: 50, black: 50 };
  }
  const cp = Number(evalCp);
  if (cp >= 9000) return { white: 100, black: 0 };
  if (cp <= -9000) return { white: 0, black: 100 };
  const whiteProb = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  const clampedWhite = Math.max(1, Math.min(99, Math.round(whiteProb)));
  return {
    white: clampedWhite,
    black: 100 - clampedWhite,
  };
}

export function parseFenDetails(fen) {
  const defaultRes = {
    whiteMaterial: 39,
    blackMaterial: 39,
    materialDiff: 0,
    whitePieces: { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 },
    blackPieces: { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 },
    whiteCenter: 0,
    blackCenter: 0,
    whiteCastled: false,
    blackCastled: false,
    whiteKingSq: 'e1',
    blackKingSq: 'e8',
    whiteDeveloped: 0,
    blackDeveloped: 0,
    isEndgame: false,
  };

  if (!fen || typeof fen !== 'string') return defaultRes;

  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  if (rows.length !== 8) return defaultRes;

  const PIECE_VALS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const CENTER_FILES = [2, 3, 4, 5];
  const CENTER_RANKS = [3, 4];

  let wMat = 0;
  let bMat = 0;
  const wPieces = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  const bPieces = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  let wCenter = 0;
  let bCenter = 0;
  let wKing = 'e1';
  let bKing = 'e8';
  let wDev = 0;
  let bDev = 0;

  for (let r = 0; r < 8; r += 1) {
    let file = 0;
    const row = rows[r];
    for (let c = 0; c < row.length; c += 1) {
      const ch = row[c];
      if (ch >= '1' && ch <= '8') {
        file += parseInt(ch, 10);
      } else {
        const isWhite = ch === ch.toUpperCase();
        const type = ch.toLowerCase();
        const sqFile = String.fromCharCode(97 + file);
        const sqRank = 8 - r;
        const sqName = `${sqFile}${sqRank}`;

        if (isWhite) {
          wPieces[type] = (wPieces[type] || 0) + 1;
          wMat += PIECE_VALS[type] || 0;
          if (type === 'k') wKing = sqName;
          if (CENTER_FILES.includes(file) && CENTER_RANKS.includes(r)) wCenter += 1;
          if (['n', 'b'].includes(type) && r !== 7) wDev += 1;
        } else {
          bPieces[type] = (bPieces[type] || 0) + 1;
          bMat += PIECE_VALS[type] || 0;
          if (type === 'k') bKing = sqName;
          if (CENTER_FILES.includes(file) && CENTER_RANKS.includes(r)) bCenter += 1;
          if (['n', 'b'].includes(type) && r !== 0) bDev += 1;
        }
        file += 1;
      }
    }
  }

  const whiteCastled = ['g1', 'h1', 'c1', 'b1'].includes(wKing);
  const blackCastled = ['g8', 'h8', 'c8', 'b8'].includes(bKing);
  const isEndgame = (wPieces.q === 0 || wMat <= 15) && (bPieces.q === 0 || bMat <= 15);

  return {
    whiteMaterial: wMat,
    blackMaterial: bMat,
    materialDiff: wMat - bMat,
    whitePieces: wPieces,
    blackPieces: bPieces,
    whiteCenter: wCenter,
    blackCenter: bCenter,
    whiteCastled,
    blackCastled,
    whiteKingSq: wKing,
    blackKingSq: bKing,
    whiteDeveloped: wDev,
    blackDeveloped: bDev,
    isEndgame,
  };
}

function describeMaterial(pieces, diff, isWhite) {
  const sideDiff = isWhite ? diff : -diff;
  const parts = [];
  if (pieces.q > 0) parts.push(`${pieces.q} Queen${pieces.q > 1 ? 's' : ''}`);
  if (pieces.r > 0) parts.push(`${pieces.r} Rook${pieces.r > 1 ? 's' : ''}`);
  if (pieces.b > 0) parts.push(`${pieces.b} Bishop${pieces.b > 1 ? 's' : ''}`);
  if (pieces.n > 0) parts.push(`${pieces.n} Knight${pieces.n > 1 ? 's' : ''}`);
  if (pieces.p > 0) parts.push(`${pieces.p} Pawn${pieces.p > 1 ? 's' : ''}`);

  const roster = parts.join(', ');
  if (sideDiff === 0) {
    return `Material is evenly balanced (${roster}).`;
  }
  if (sideDiff > 0) {
    return `Holds a +${sideDiff} material advantage (${roster}).`;
  }
  return `Trailing by ${Math.abs(sideDiff)} points in material (${roster}).`;
}

function describeMoveAction(currentMove) {
  if (!currentMove || !currentMove.san) return null;
  const san = currentMove.san;
  if (san.startsWith('O-O')) return 'King castled into safety, securing the flank and connecting rooks.';
  if (san.includes('x')) return `Executed tactical capture (${san}), clarifying board tension.`;
  if (san.includes('+')) return `Delivers check against the opponent king (${san}), seizing urgent tempo.`;
  if (san.startsWith('N')) return `Maneuvers knight (${san}) toward central outposts and active files.`;
  if (san.startsWith('B')) return `Deploys bishop (${san}) to contest key diagonal corridors.`;
  if (san.startsWith('R')) return `Activates rook (${san}) along open corridors and rank targets.`;
  if (san.startsWith('Q')) return `Centralizes queen (${san}) with multi-directional tactical pressure.`;
  if (san.startsWith('K')) return `King repositions (${san}) to balance safety with endgame activity.`;
  return `Advances pawn (${san}) to gain space and challenge central squares.`;
}

function describePieces(fenInfo, isWhite, currentMove) {
  const moveAction = describeMoveAction(currentMove);
  const sideMoved = currentMove && (Boolean(currentMove.is_white) === isWhite);

  if (sideMoved && moveAction) {
    return moveAction;
  }

  const center = isWhite ? fenInfo.whiteCenter : fenInfo.blackCenter;
  const pieces = isWhite ? fenInfo.whitePieces : fenInfo.blackPieces;
  const oppPieces = isWhite ? fenInfo.blackPieces : fenInfo.whitePieces;

  if (fenInfo.isEndgame) {
    if (pieces.p > oppPieces.p) {
      return 'Endgame stage: has advanced passed pawns and strong king centralization to support pawn promotion.';
    }
    return 'Endgame stage: pieces are coordinated around critical blockade squares and defense against opponent advances.';
  }

  const notes = [];
  if (center >= 2) {
    notes.push('Exerts strong control over the central squares (e4, d4, e5, d5)');
  } else if (center === 1) {
    notes.push('Maintains an active presence in the central files');
  } else {
    notes.push('Operates with flexible flank coordination');
  }

  if (pieces.b === 2 && oppPieces.b < 2) {
    notes.push('enjoys the bishop pair advantage controlling both color complexes');
  } else if (pieces.r >= 2) {
    notes.push('rooks are connected and ready to contest open files');
  } else {
    notes.push('pieces maintain solid structural harmony');
  }

  return notes.join(', ') + '.';
}

function describeKing(fenInfo, isWhite) {
  const castled = isWhite ? fenInfo.whiteCastled : fenInfo.blackCastled;
  const kingSq = isWhite ? fenInfo.whiteKingSq : fenInfo.blackKingSq;

  if (fenInfo.isEndgame) {
    return `King on ${kingSq} actively participates in the endgame, restricting opposing infiltration.`;
  }

  if (castled) {
    return `King on ${kingSq} is safely castled with a sheltered pawn structure and minimal tactical vulnerabilities.`;
  }

  if (['e1', 'd1', 'e8', 'd8'].includes(kingSq)) {
    return `King remains in the central sector on ${kingSq}; completing development and securing king shelter remains a priority.`;
  }

  return `King is positioned on ${kingSq}, balancing mobility with piece shelter.`;
}

function describeVerdictWithMove(winPct, isWhite, playerName, currentMove) {
  const name = playerName || (isWhite ? 'White' : 'Black');
  const sideMoved = currentMove && (Boolean(currentMove.is_white) === isWhite);
  const oppSideMoved = currentMove && (Boolean(currentMove.is_white) !== isWhite);
  const cls = currentMove?.classification;
  const bestSan = currentMove?.best_move_san;
  const san = currentMove?.san;
  const cpLoss = currentMove?.cp_loss ? `${(currentMove.cp_loss / 100).toFixed(1)}` : 'eval';

  if (sideMoved && cls === 'blunder') {
    return `Blunder (${san ?? 'move'}). ${bestSan ? `${bestSan} was best.` : ''} Drops ${cpLoss} in evaluation, creating serious tactical vulnerabilities for ${name}.`;
  }
  if (oppSideMoved && cls === 'blunder') {
    return `Seizes commanding advantage (${winPct}%) after opponent blunder (${san ?? 'move'}). ${name} holds decisive attacking pathways.`;
  }

  if (sideMoved && cls === 'mistake') {
    return `Mistake (${san ?? 'move'}). ${bestSan ? `${bestSan} was best.` : ''} Suboptimal move conceding ${cpLoss} and allowing opponent initiative.`;
  }
  if (oppSideMoved && cls === 'mistake') {
    return `Capitalizes on opponent mistake (${san ?? 'move'}) to claim an active initiative (${winPct}%).`;
  }

  if (sideMoved && cls === 'inaccuracy') {
    return `Inaccuracy (${san ?? 'move'}). ${bestSan ? `${bestSan} was best.` : ''} Concedes minor positional ground, shifting momentum toward opponent.`;
  }
  if (oppSideMoved && cls === 'inaccuracy') {
    return `Takes initiative following opponent inaccuracy (${san ?? 'move'}), strengthening board coordination (${winPct}%).`;
  }

  if (sideMoved && (cls === 'best' || currentMove?.is_best)) {
    return `★ Best move! Stockfish confirms ${san ?? 'move'} as the highest-quality engine choice, maintaining peak position (${winPct}%).`;
  }

  if (winPct >= 80) {
    return `Clear winning position (${winPct}%). ${name} controls the pace with decisive tactical threats and breakthrough opportunities.`;
  }
  if (winPct >= 65) {
    return `Substantial advantage (${winPct}%). ${name} has superior piece coordination, territorial command, and constant pressure.`;
  }
  if (winPct >= 55) {
    return `Slight initiative (${winPct}%). ${name} holds an active edge and comfortable space.`;
  }
  if (winPct >= 45) {
    return `Dynamic equilibrium (${winPct}%). The position is level with equal chances for both sides.`;
  }
  if (winPct >= 35) {
    return `Defensive task (${winPct}%). ${name} is slightly under pressure and must defend carefully.`;
  }
  if (winPct >= 20) {
    return `Challenging defense (${winPct}%). ${name} faces sustained pressure from opponent pieces.`;
  }
  return `Critical position (${winPct}%). ${name} is under heavy assault and requires precise defensive resources.`;
}

export function generatePositionExplanations(fen, evalCp, currentMove, whiteName, blackName) {
  const probs = evalToWinProbabilities(evalCp);
  const fenInfo = parseFenDetails(fen);

  const white = {
    playerName: whiteName || 'White',
    color: 'white',
    winPct: probs.white,
    materialText: describeMaterial(fenInfo.whitePieces, fenInfo.materialDiff, true),
    piecesText: describePieces(fenInfo, true, currentMove),
    kingText: describeKing(fenInfo, true),
    verdictText: describeVerdictWithMove(probs.white, true, whiteName, currentMove),
  };

  const black = {
    playerName: blackName || 'Black',
    color: 'black',
    winPct: probs.black,
    materialText: describeMaterial(fenInfo.blackPieces, fenInfo.materialDiff, false),
    piecesText: describePieces(fenInfo, false, currentMove),
    kingText: describeKing(fenInfo, false),
    verdictText: describeVerdictWithMove(probs.black, false, blackName, currentMove),
  };

  return { white, black };
}

export function extractKeyMoments(moves = []) {
  if (!Array.isArray(moves)) return [];
  const moments = [];

  moves.forEach((m, idx) => {
    if (!m) return;
    const cls = m.classification;
    const cpLoss = Math.abs(Number(m.cp_loss || 0));
    const isBad = ['blunder', 'mistake', 'inaccuracy'].includes(cls);
    const hasSwing = cpLoss >= 70;

    if (isBad || hasSwing) {
      const ply = m.ply != null ? m.ply : idx + 1;
      const moveNum = m.move_number || Math.floor((ply - 1) / 2) + 1;
      const isWhite = m.is_white ?? (ply % 2 === 1);
      const evalCp = m.eval_after_cp ?? 0;
      const evalText = evalCp >= 0 ? `+${(evalCp / 100).toFixed(1)}` : `${(evalCp / 100).toFixed(1)}`;

      moments.push({
        ply,
        moveNumber: moveNum,
        turn: isWhite ? 'white' : 'black',
        san: m.san || `p${ply}`,
        classification: cls || (cpLoss >= 200 ? 'blunder' : cpLoss >= 100 ? 'mistake' : 'inaccuracy'),
        bestMoveSan: m.best_move_san || m.best_move || '',
        cpLoss: m.cp_loss || 0,
        evalText,
        comment: m.comment || '',
      });
    }
  });

  return moments;
}

export function computeGameStats(moves = []) {
  const defaultRes = {
    white: { accuracy: 85, blunders: 0, mistakes: 0, inaccuracies: 0, bestMoves: 0, total: 0 },
    black: { accuracy: 85, blunders: 0, mistakes: 0, inaccuracies: 0, bestMoves: 0, total: 0 },
  };

  if (!Array.isArray(moves) || moves.length === 0) return defaultRes;

  let wAccSum = 0;
  let wAccCount = 0;
  let bAccSum = 0;
  let bAccCount = 0;

  const wCounts = { blunders: 0, mistakes: 0, inaccuracies: 0, bestMoves: 0, total: 0 };
  const bCounts = { blunders: 0, mistakes: 0, inaccuracies: 0, bestMoves: 0, total: 0 };

  moves.forEach((m, idx) => {
    if (!m) return;
    const isWhite = m.is_white ?? (idx % 2 === 0);
    const target = isWhite ? wCounts : bCounts;
    target.total += 1;

    const cls = m.classification;
    if (cls === 'blunder') target.blunders += 1;
    else if (cls === 'mistake') target.mistakes += 1;
    else if (cls === 'inaccuracy') target.inaccuracies += 1;
    else if (cls === 'best' || m.is_best) target.bestMoves += 1;

    if (m.accuracy_score != null) {
      if (isWhite) {
        wAccSum += Number(m.accuracy_score);
        wAccCount += 1;
      } else {
        bAccSum += Number(m.accuracy_score);
        bAccCount += 1;
      }
    }
  });

  return {
    white: {
      ...wCounts,
      accuracy: wAccCount > 0 ? Math.round(wAccSum / wAccCount) : 85,
    },
    black: {
      ...bCounts,
      accuracy: bAccCount > 0 ? Math.round(bAccSum / bAccCount) : 85,
    },
  };
}

export function evaluatePositionHeuristicCp(fen) {
  if (!fen || typeof fen !== 'string') return 0;
  const parts = fen.trim().split(/\s+/);
  const position = parts[0];
  const rows = position.split('/');
  if (rows.length !== 8) return 0;

  let whiteScore = 0;
  let blackScore = 0;
  let whiteBishops = 0;
  let blackBishops = 0;

  const PIECE_VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  for (let r = 0; r < 8; r += 1) {
    let file = 0;
    const row = rows[r];
    for (let c = 0; c < row.length; c += 1) {
      const ch = row[c];
      if (ch >= '1' && ch <= '8') {
        file += parseInt(ch, 10);
      } else {
        const isWhite = ch === ch.toUpperCase();
        const type = ch.toLowerCase();
        const val = PIECE_VAL[type] || 0;
        const rankFromBottom = 8 - r;
        let posBonus = 0;

        if (type === 'p') {
          if ((file === 3 || file === 4) && (rankFromBottom === 4 || rankFromBottom === 5)) {
            posBonus += 25;
          } else if (file >= 2 && file <= 5 && rankFromBottom >= 3 && rankFromBottom <= 6) {
            posBonus += 10;
          }
          if (isWhite && rankFromBottom >= 5) posBonus += (rankFromBottom - 4) * 20;
          if (!isWhite && rankFromBottom <= 4) posBonus += (5 - rankFromBottom) * 20;
        } else if (type === 'n' || type === 'b') {
          if (type === 'b') {
            if (isWhite) whiteBishops += 1;
            else blackBishops += 1;
          }
          if (isWhite && r !== 7) posBonus += 20;
          if (!isWhite && r !== 0) posBonus += 20;
          if (file >= 2 && file <= 5 && rankFromBottom >= 3 && rankFromBottom <= 6) {
            posBonus += 15;
          }
        } else if (type === 'r') {
          if (file === 3 || file === 4) posBonus += 15;
        } else if (type === 'k') {
          if (isWhite && rankFromBottom === 1 && (file === 6 || file === 1 || file === 2)) {
            posBonus += 30;
          }
          if (!isWhite && rankFromBottom === 8 && (file === 6 || file === 1 || file === 2)) {
            posBonus += 30;
          }
        }

        if (isWhite) {
          whiteScore += val + posBonus;
        } else {
          blackScore += val + posBonus;
        }
        file += 1;
      }
    }
  }

  if (whiteBishops >= 2) whiteScore += 40;
  if (blackBishops >= 2) blackScore += 40;

  return whiteScore - blackScore;
}

export function buildWinPercentageGraph(moves = [], evalGraph = []) {
  const result = [];
  const evalByPly = new Map();

  if (Array.isArray(evalGraph)) {
    evalGraph.forEach((entry) => {
      if (entry && entry.ply != null) {
        evalByPly.set(entry.ply, entry);
      }
    });
  }

  const pliesCount = Math.max(moves.length, evalGraph.length);
  if (pliesCount === 0) {
    return [
      {
        ply: 0,
        moveNumber: 0,
        san: 'Start',
        turn: 'white',
        winWhite: 50,
        winBlack: 50,
        evalCp: 0,
      },
    ];
  }

  let lastKnownEvalCp = 0;
  let lastKnownFen = null;

  for (let p = 0; p <= pliesCount; p += 1) {
    if (p === 0) {
      result.push({
        ply: 0,
        moveNumber: 0,
        san: 'Start',
        turn: 'white',
        winWhite: 50,
        winBlack: 50,
        evalCp: 0,
      });
      continue;
    }

    const move = moves[p - 1];
    const engineEntry = evalByPly.get(p);
    let winWhite = 50;
    let evalCp = 0;

    if (engineEntry && engineEntry.win_white != null) {
      winWhite = Math.max(1, Math.min(99, Math.round(Number(engineEntry.win_white))));
      evalCp = Number(engineEntry.eval_cp ?? 0);
      lastKnownEvalCp = evalCp;
      lastKnownFen = move?.fen_after || null;
    } else if (move && move.eval_after_cp != null) {
      const calc = evalToWinProbabilities(move.eval_after_cp);
      winWhite = calc.white;
      evalCp = Number(move.eval_after_cp);
      lastKnownEvalCp = evalCp;
      lastKnownFen = move?.fen_after || null;
    } else if (move && move.win_probability_after != null) {
      winWhite = Math.max(1, Math.min(99, Math.round(Number(move.win_probability_after))));
      evalCp = lastKnownEvalCp;
    } else if (move && move.fen_after) {
      const currentHeuristic = evaluatePositionHeuristicCp(move.fen_after);
      if (lastKnownFen) {
        const prevHeuristic = evaluatePositionHeuristicCp(lastKnownFen);
        const delta = currentHeuristic - prevHeuristic;
        evalCp = Math.round(lastKnownEvalCp + delta);
      } else {
        evalCp = currentHeuristic;
      }
      lastKnownEvalCp = evalCp;
      lastKnownFen = move.fen_after;
      const calc = evalToWinProbabilities(evalCp);
      winWhite = calc.white;
    } else if (result.length > 0) {
      winWhite = result[result.length - 1].winWhite;
      evalCp = result[result.length - 1].evalCp;
    }

    const winBlack = 100 - winWhite;
    result.push({
      ply: p,
      moveNumber: Math.floor((p - 1) / 2) + 1,
      san: (move && move.san) ? move.san : '',
      turn: p % 2 === 1 ? 'white' : 'black',
      winWhite,
      winBlack,
      evalCp,
    });
  }

  return result;
}
