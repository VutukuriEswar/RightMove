# Extracts 32-feature position vector and computes difficulty metrics
from collections import Counter
import chess
import numpy as np
from scipy.stats import entropy as scipy_entropy


# Extracts 32-element normalized numerical feature vector from board state
def extract_features(board: chess.Board) -> np.ndarray:
    features = []

    piece_values = {
        chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
        chess.ROOK: 5, chess.QUEEN: 9
    }
    white_mat = sum(len(board.pieces(pt, chess.WHITE)) * v for pt, v in piece_values.items())
    black_mat = sum(len(board.pieces(pt, chess.BLACK)) * v for pt, v in piece_values.items())

    features += [
        (white_mat + black_mat) / 78.0,
        (white_mat - black_mat) / 9.0,
        float(len(board.pieces(chess.QUEEN, chess.WHITE)) + len(board.pieces(chess.QUEEN, chess.BLACK))),
        float(len(board.pieces(chess.ROOK, chess.WHITE)) + len(board.pieces(chess.ROOK, chess.BLACK))),
        float(len(board.pieces(chess.BISHOP, chess.WHITE)) + len(board.pieces(chess.BISHOP, chess.BLACK))),
        float(len(board.pieces(chess.KNIGHT, chess.WHITE)) + len(board.pieces(chess.KNIGHT, chess.BLACK))),
    ]

    white_pawns = board.pieces(chess.PAWN, chess.WHITE)
    black_pawns = board.pieces(chess.PAWN, chess.BLACK)

    def count_isolated(pawns):
        count = 0
        for sq in pawns:
            f = chess.square_file(sq)
            adjacent = [af for af in [f - 1, f + 1] if 0 <= af <= 7]
            has_neighbor = any(
                chess.square(af, r) in pawns
                for af in adjacent for r in range(8)
            )
            if not has_neighbor:
                count += 1
        return count

    def count_doubled(pawns):
        file_counts = Counter(chess.square_file(sq) for sq in pawns)
        return sum(c - 1 for c in file_counts.values() if c > 1)

    def count_passed(pawns, direction, opp_pawns):
        count = 0
        for sq in pawns:
            f, r = chess.square_file(sq), chess.square_rank(sq)
            passed = True
            for osq in opp_pawns:
                of, or_ = chess.square_file(osq), chess.square_rank(osq)
                if abs(of - f) <= 1:
                    if (direction == 1 and or_ > r) or (direction == -1 and or_ < r):
                        passed = False
                        break
            if passed:
                count += 1
        return count

    def pawn_entropy(pawns):
        file_counts = [0] * 8
        for sq in pawns:
            file_counts[chess.square_file(sq)] += 1
        total = sum(file_counts)
        if total == 0:
            return 0.0
        probs = [c / total for c in file_counts if c > 0]
        return float(scipy_entropy(probs) / np.log(8))

    features += [
        count_isolated(white_pawns) / 8.0,
        count_isolated(black_pawns) / 8.0,
        count_doubled(white_pawns) / 8.0,
        count_doubled(black_pawns) / 8.0,
        count_passed(white_pawns, 1, black_pawns) / 8.0,
        count_passed(black_pawns, -1, white_pawns) / 8.0,
        pawn_entropy(white_pawns),
        pawn_entropy(black_pawns),
    ]

    bc = board.copy()
    bc.turn = chess.WHITE
    white_moves = len(list(bc.legal_moves))
    bc.turn = chess.BLACK
    black_moves = len(list(bc.legal_moves))

    mobility_ratio = white_moves / black_moves if black_moves > 0 else 2.0
    white_advanced = sum(1 for sq, p in board.piece_map().items()
                         if p.color == chess.WHITE and chess.square_rank(sq) >= 4)
    black_advanced = sum(1 for sq, p in board.piece_map().items()
                         if p.color == chess.BLACK and chess.square_rank(sq) <= 3)
    open_files = sum(
        1 for f in range(8)
        if not any(
            board.piece_at(chess.square(f, r)) is not None and
            board.piece_at(chess.square(f, r)).piece_type == chess.PAWN
            for r in range(8)
        )
    )

    features += [
        white_moves / 40.0,
        black_moves / 40.0,
        min(mobility_ratio, 3.0) / 3.0,
        white_advanced / 16.0,
        black_advanced / 16.0,
        open_files / 8.0,
    ]

    def king_safety(color):
        king_sq = board.king(color)
        if king_sq is None:
            return 0.0, 0.0
        kf, kr = chess.square_file(king_sq), chess.square_rank(king_sq)
        shield_ranks = [kr + 1, kr + 2] if color == chess.WHITE else [kr - 1, kr - 2]
        shield_files = [f for f in [kf - 1, kf, kf + 1] if 0 <= f <= 7]

        shield = sum(
            1 for f in shield_files for r in shield_ranks
            if 0 <= r <= 7 and
            board.piece_at(chess.square(f, r)) == chess.Piece(chess.PAWN, color)
        )
        open_near = sum(
            1 for f in shield_files
            if not any(
                board.piece_at(chess.square(f, r)) is not None and
                board.piece_at(chess.square(f, r)).piece_type == chess.PAWN
                for r in range(8)
            )
        )
        return shield / 6.0, open_near / 3.0

    ws, wo = king_safety(chess.WHITE)
    bs, bo = king_safety(chess.BLACK)
    features += [ws, wo, bs, bo]

    total_pieces = len(board.piece_map())
    phase = 0.0 if total_pieces >= 28 else (1.0 if total_pieces >= 14 else 2.0)
    features += [phase / 2.0, board.fullmove_number / 100.0, total_pieces / 32.0]

    def count_hanging(color):
        opp = not color
        return sum(
            1 for sq, p in board.piece_map().items()
            if p.color == color and
               board.is_attacked_by(opp, sq) and
               not board.is_attacked_by(color, sq)
        )

    def count_attacked(color):
        opp = not color
        return sum(1 for sq, p in board.piece_map().items()
                   if p.color == color and board.is_attacked_by(opp, sq))

    features += [
        count_hanging(chess.WHITE) / 8.0,
        count_hanging(chess.BLACK) / 8.0,
        count_attacked(chess.WHITE) / 16.0,
        count_attacked(chess.BLACK) / 16.0,
        1.0 if board.is_check() else 0.0,
    ]

    return np.array(features, dtype=np.float32)


# Calculates tactical difficulty multiplier for position scheduling
def position_difficulty(features: np.ndarray) -> float:
    tactical_score = (features[27] + features[28]) * 0.5
    phase_factor = 1.0 - features[24]
    mobility_imbalance = abs(features[16] - 0.5)
    raw = 0.5 + tactical_score * 0.3 + phase_factor * 0.1 + mobility_imbalance * 0.1
    return float(np.clip(raw, 0.5, 1.5))


# Computes cosine similarity between two feature vectors
def cosine_similarity(vec_a: list | np.ndarray, vec_b: list | np.ndarray) -> float:
    a = np.array(vec_a, dtype=np.float32)
    b = np.array(vec_b, dtype=np.float32)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))
