# Provides matchmaking, analysis and coaching intelligence services.
import time
import logging
from typing import Optional
from core import get_db
import hashlib
import re
import chess
import math
import os
import io
import chess.pgn
from pathlib import Path
from gm import SAMPLE_GM_PGNS
from typing import Dict, Any, List

# Section services/matchmaking_service
logger = logging.getLogger(__name__)


# Enqueues player into matchmaking queue
async def enqueue(user_id: str, time_control_seconds: int = 600, increment_seconds: int = 0):
    db = get_db()
    await db.matchmaking.update_one(
        {"user_id": user_id},
        {"$set": {
            "time_control_seconds": time_control_seconds,
            "increment_seconds": increment_seconds,
            "joined_at": time.time(),
            "matched_game_id": None,
            "opponent_id": None
        }},
        upsert=True
    )
    logger.info(f"[matchmaking] {user_id} joined queue (tc={time_control_seconds}+{increment_seconds})")

# Removes player from matchmaking queue
async def dequeue(user_id: str):
    db = get_db()
    await db.matchmaking.delete_one({"user_id": user_id})
    logger.info(f"[matchmaking] {user_id} removed from queue")

# Checks queue for available match
async def check_for_match(user_id: str) -> Optional[dict]:
    db = get_db()

    user_entry = await db.matchmaking.find_one({"user_id": user_id})
    if not user_entry:
        return None

    if user_entry.get("matched_game_id"):
        return {
            "game_id": user_entry["matched_game_id"],
            "opponent_id": user_entry["opponent_id"],
            "is_creator": False
        }

    opponent = await db.matchmaking.find_one({
        "user_id": {"$ne": user_id},
        "matched_game_id": None,
        "time_control_seconds": user_entry["time_control_seconds"],
        "increment_seconds": user_entry["increment_seconds"],
    }, sort=[("joined_at", 1)])

    if opponent:
        return {
            "opponent_id": opponent["user_id"],
            "is_creator": True
        }

    return None

# Marks opponent queue entry as matched
async def set_matched(opponent_id: str, game_id: str, my_user_id: str):
    db = get_db()
    await db.matchmaking.update_one(
        {"user_id": opponent_id},
        {"$set": {
            "matched_game_id": game_id,
            "opponent_id": my_user_id
        }}
    )

# Section services/summary_service

# Re-exports review-match summary helper
from review import generate_summary

# Section services/explanation_service

logger = logging.getLogger(__name__)


_CACHE: dict[str, dict] = {}


_CACHE_MAX = 200


# Builds cache key from parts
def _cache_key(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(str(p).encode("utf-8", errors="ignore"))
        h.update(b"\x00")
    return h.hexdigest()

# Caches value under key and returns it
def _remember(key: str, value: dict) -> dict:
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[key] = value
    return value

# Builds coaching prompt for language model
def build_prompt(fen: str, player_move_san: str, best_move_san: str,
                 classification: str, cp_loss: float, eval_cp: Optional[float],
                 advantages: list[str], disadvantages: list[str],
                 top_moves: list[dict]) -> tuple[str, str]:
    top_lines = "\n".join(
        f"- {t.get('move_san')} (eval {t.get('eval_cp', t.get('score_white', '?'))})"
        for t in (top_moves or [])[:3]
    ) or "- (no engine line available)"
    adv = "\n".join(f"- {a}" for a in (advantages or [])[:4]) or "- none spotted"
    dis = "\n".join(f"- {d}" for d in (disadvantages or [])[:4]) or "- none spotted"
    eval_line = f"{(eval_cp / 100.0):.2f} pawns" if isinstance(eval_cp, (int, float)) else "n/a"
    system = (
        "You are a friendly chess coach for a club player (~1200). "
        "Plain everyday language, specific squares and pieces, under 200 words. "
        "Reply with ONLY the three sections below. Never repeat the questions."
    )
    user = (
        f"Position (FEN): {fen}\n"
        f"Played: {player_move_san} ('{classification}', ~{cp_loss:.0f} cp off best). "
        f"Best was {best_move_san}; eval now {(eval_line)}.\n"
        f"Engine ideas:\n{top_lines}\nNotes for: {adv}\nAgainst: {dis}\n\n"
        "VERDICT: one line — good or not, and why in 8 words.\n"
        "WHY: 2 bullets — what it does, what it gives up.\n"
        "BETTER PLAN: move to play instead + the simple idea."
    )
    return system, user

_LOCAL_PIPE = {"model_id": None, "pipe": None}


_LOCAL_PIPE_LOCK = None


# Returns process-wide lock singleton
def _local_lock():
    global _LOCAL_PIPE_LOCK
    if _LOCAL_PIPE_LOCK is None:
        import threading
        _LOCAL_PIPE_LOCK = threading.RLock()
    return _LOCAL_PIPE_LOCK

# Ensures local model snapshot exists on disk
def _ensure_local_snapshot(model_id: str) -> str:
    from huggingface_hub import snapshot_download
    from huggingface_hub.utils import LocalEntryNotFoundError
    try:
        return snapshot_download(repo_id=model_id, local_files_only=True)
    except LocalEntryNotFoundError:
        logger.info(f"[explain] local model '{model_id}' not cached — downloading…")
        return snapshot_download(repo_id=model_id)
    except Exception:
        return snapshot_download(repo_id=model_id)

# Returns singleton local text pipeline
def _get_local_pipe(model_id: str):
    from transformers import pipeline
    with _local_lock():
        if _LOCAL_PIPE["pipe"] is not None and _LOCAL_PIPE["model_id"] == model_id:
            return _LOCAL_PIPE["pipe"]
        _ensure_local_snapshot(model_id)
        gen = pipeline("text-generation", model=model_id,
                       max_new_tokens=350, do_sample=False, trust_remote_code=False,
                       return_full_text=False)
        try:
            import torch
            torch.set_num_threads(max(1, (torch.get_num_threads() or 4) - 2))
        except Exception:
            pass
        _LOCAL_PIPE["model_id"] = model_id
        _LOCAL_PIPE["pipe"] = gen
        return gen

# Runs small local fallback model
def _hf_local_text(system: str, user: str) -> Optional[str]:
    from core import get_settings
    settings = get_settings()
    try:
        import os as _os
        from pathlib import Path as _Path
        _default_cache = str(_Path(__file__).resolve().parent / "models")
        _os.environ.setdefault("HF_HUB_CACHE", _default_cache)
        _os.environ.setdefault("HF_HOME", _default_cache)
        _os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
        _Path(_default_cache).mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    try:
        from transformers import pipeline  # noqa: F401 (ensures dep present)
    except Exception:
        logger.info("[explain] transformers not installed — skipping local fallback")
        return None
    try:
        model_id = (settings.hf_local_model_id or "").strip()
        if not model_id:
            return None
        with _local_lock():
            gen = _get_local_pipe(model_id)
            out = gen(f"{system}\n\n{user}")
        text = (out[0].get("generated_text") or "").strip()[:2000].strip()
        return text or None
    except Exception as e:
        logger.info(f"[explain] local model failed: {e}")
        return None

# Builds offline fallback from engine numbers
def _rule_based_text(player_move_san: str, best_move_san: str, classification: str,
                     cp_loss: float, advantages: list[str],
                     disadvantages: list[str]) -> dict:
    verdict = {
        "Best Move": f"VERDICT: {player_move_san} is the best move — nothing to fix.",
        "Excellent": f"VERDICT: {player_move_san} is excellent — basically the best idea.",
        "Good": f"VERDICT: {player_move_san} is good — sound, just not the sharpest.",
        "Inaccuracy": f"VERDICT: {player_move_san} is slightly off — it gives away a small edge.",
        "Mistake": f"VERDICT: {player_move_san} is a mistake — it hands the initiative over.",
        "Blunder": f"VERDICT: {player_move_san} is a blunder — it likely changes who is winning.",
    }.get(classification, f"VERDICT: {player_move_san} — {classification}.")
    why = [f"• {a}" for a in (advantages or [])[:2]]
    why += [f"• Watch out: {d}" for d in (disadvantages or [])[:2]]
    if not why:
        why = ["• No standout positional swing either way."]
    better = (f"BETTER PLAN: play {best_move_san} instead — it keeps about "
              f"{cp_loss:.0f} centipawns more of your advantage. "
              f"Ask before every move: what does it threaten, and what does it leave hanging?")
    if classification in ("Best Move", "Excellent") or (best_move_san or "") == (player_move_san or ""):
        better = ("BETTER PLAN: you already found it — replay why this square matters "
                  "(control, safety, or a threat) so you spot it faster next time.")
    text = f"{verdict}\nWHY:\n" + "\n".join(why) + f"\n{better}"
    return {"text": text, "advantages": list(advantages or [])[:6],
            "suggestions": [better], "source": "rule-based"}

# Collapses repeated echo lines preserving order
def _dedupe_echo(text: str) -> str:
    seen: set[str] = set()
    out: list[str] = []
    for line in text.splitlines():
        key = line.strip().lower()
        if key and key in seen and len(key) > 20:
            continue
        seen.add(key)
        out.append(line)
    return "\n".join(out).strip()

_ECHO_RES = [
    r"section \d",
    r"notes for:",
    r"^against:",
    r"one line",
    r"2 bullets",
    r"simple idea",
    r"what it does",
    r"what it gives up",
    r"position \(fen\)",
    r"engine ideas",
    r"cp off best",
    r"best was \w+; eval now",
    r"side to move should aim",
]


# Drops lines requoting prompt
def _strip_prompt_echo(text: str) -> str:
    import re as _re
    out: list[str] = []
    for line in text.splitlines():
        low = line.strip().lower()
        if low and any(_re.search(pat, low) for pat in _ECHO_RES):
            continue
        out.append(line)
    cleaned = _re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()
    return cleaned

_HEADERS = ["VERDICT", "WHY", "BETTER PLAN"]


# Extracts named section from text
def _get_section(text: str, header: str) -> str:
    import re as _re
    others = "|".join(h for h in _HEADERS if h != header)
    m = _re.search(rf"(?im)^{_re.escape(header)}:\s*(.*?)(?=^(?:{others}):|\Z)", text, _re.S)
    return (m.group(1).strip() if m else "")

# Merges AI prose with rule-based fallback
def _ensure_all_sections(ai_text: str, rule_text: str) -> str:
    parts = []
    for h in _HEADERS:
        body = _get_section(ai_text, h) or _get_section(rule_text, h)
        parts.append(f"{h}:\n{body}" if body else f"{h}:")
    return "\n".join(parts).strip()

# Splits prose into advantages and suggestions
def _split_sections(text: str) -> tuple[list[str], list[str]]:
    advantages, suggestions = [], []
    cur = None
    for line in text.splitlines():
        up = line.strip().upper()
        if up.startswith("WHY"):
            cur = advantages
            continue
        if up.startswith("BETTER PLAN") or up.startswith("SUGGEST"):
            cur = suggestions
            continue
        if up.startswith("VERDICT"):
            continue
        clean = re.sub(r"^[\-•*\d.)\s]+", "", line.strip())
        if clean and cur is not None:
            cur.append(clean)
    return advantages[:6], suggestions[:4]

# Checks whether HF explanations are enabled
def _hf_enabled() -> bool:
    try:
        from core import get_settings
        return bool(get_settings().hf_explanations_enabled)
    except Exception:
        return True

# Explains move with rich coaching narrative
async def explain_move_rich(fen: str, player_move_san: str, best_move_san: str,
                            classification: str = "Good", cp_loss: float = 0.0,
                            eval_cp: Optional[float] = None,
                            advantages: Optional[list[str]] = None,
                            disadvantages: Optional[list[str]] = None,
                            top_moves: Optional[list[dict]] = None) -> dict:
    advantages = advantages or []
    disadvantages = disadvantages or []
    key = _cache_key("move", fen, player_move_san, best_move_san, classification, str(cp_loss))
    if key in _CACHE:
        return _CACHE[key]
    system, user = build_prompt(fen, player_move_san, best_move_san, classification,
                                cp_loss, eval_cp, advantages, disadvantages, top_moves or [])
    rule_fallback = _rule_based_text(player_move_san, best_move_san, classification,
                                       cp_loss, advantages, disadvantages)
    if not _hf_enabled():
        return _remember(key, rule_fallback)
    try:
        import asyncio
        text = await asyncio.wait_for(asyncio.to_thread(_hf_local_text, system, user), timeout=180)
        if text:
            text = _ensure_all_sections(
                _strip_prompt_echo(_dedupe_echo(text)), rule_fallback["text"])
            adv, sug = _split_sections(text)
            return _remember(key, {"text": text,
                                   "advantages": adv or advantages[:6],
                                   "suggestions": sug or [f"Consider {best_move_san}."],
                                   "source": "hf-local"})
    except Exception as e:
        logger.info(f"[explain] local path failed: {e}")
    return _remember(key, rule_fallback)

# Explains static position with rich narrative
async def explain_position_rich(fen: str, verdict: str,
                                parameters: Optional[dict] = None,
                                turn: str = "white") -> dict:
    key = _cache_key("pos", fen)
    if key in _CACHE:
        return _CACHE[key]
    edges: list[str] = []
    try:
        for _k, p in (parameters or {}).items():
            if isinstance(p, dict):
                d = float(p.get("diff", 0))
                if abs(d) >= 15:
                    edges.append(f"{p.get('name', _k)}: {'White' if d > 0 else 'Black'} +{abs(d):.0f}")
    except Exception:
        pass
    system = ("You are a friendly chess coach for a club player (~1200). "
              "Plain everyday language, specific squares and pieces, under 180 words. "
              "Reply with ONLY the three sections below. Never repeat the questions.")
    user = (f"Position (FEN): {fen}\nSide to move: {turn}.\n"
            f"Engine verdict: {verdict}\n"
            f"Standout factors:\n" + ("\n".join(f"- {e}" for e in edges[:6]) or "- balanced") +
            "\n\nVERDICT: one line — who stands better, in plain words.\n"
            "WHY: 2 bullets — the concrete reasons.\n"
            "BETTER PLAN: what the side to move should aim for next.")
    rule_text = (f"VERDICT: {verdict}\nWHY:\n" +
                 ("\n".join(f"• {e}" for e in edges[:3]) if edges else "• No single factor dominates — small edges everywhere.") +
                 f"\nBETTER PLAN: improve your worst piece, keep the king safe, and create one real threat for {turn}.")
    if not _hf_enabled():
        return _remember(key, {"text": rule_text, "advantages": edges[:6],
                               "suggestions": [f"Play around the plan above for {turn}."],
                               "source": "rule-based"})
    try:
        import asyncio
        text = await asyncio.wait_for(asyncio.to_thread(_hf_local_text, system, user), timeout=180)
        if text:
            text = _ensure_all_sections(
                _strip_prompt_echo(_dedupe_echo(text)), rule_text)
            adv, sug = _split_sections(text)
            return _remember(key, {"text": text,
                                   "advantages": adv or edges[:6],
                                   "suggestions": sug or [f"Play around the plan above for {turn}."],
                                   "source": "hf-local"})
    except Exception as e:
        logger.info(f"[explain] local position path failed: {e}")
    return _remember(key, {"text": rule_text, "advantages": edges[:6],
                           "suggestions": [f"Play around the plan above for {turn}."], "source": "rule-based"})

# Section coaching/tactical_analysis

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000,
}


# Scans board for tactical and positional patterns
class TacticalMotifDetector:

    # Detects tactical motifs for move
    @staticmethod
    def detect_motifs(board: chess.Board, move: chess.Move = None):
        motifs = []

        try:
            motifs.extend(TacticalMotifDetector._detect_pins(board))
        except Exception:
            pass

        try:
            motifs.extend(TacticalMotifDetector._detect_forks(board))
        except Exception:
            pass

        try:
            motifs.extend(TacticalMotifDetector._detect_skewers(board))
        except Exception:
            pass

        if move:
            try:
                motifs.extend(TacticalMotifDetector._detect_discovered(board, move))
            except Exception:
                pass

        try:
            motifs.extend(TacticalMotifDetector._detect_back_rank(board))
        except Exception:
            pass

        try:
            motifs.extend(TacticalMotifDetector._detect_outposts(board))
        except Exception:
            pass

        return list(dict.fromkeys(motifs))

    # Detects pin motifs on board
    @staticmethod
    def _detect_pins(board: chess.Board):
        pins = []
        for color in [chess.WHITE, chess.BLACK]:
            k_sq = board.king(color)
            if k_sq is None:
                continue

            opp_color = not color
            color_name = "White" if color == chess.WHITE else "Black"
            opp_name = "Black" if color == chess.WHITE else "White"

            for slider_sq, piece in board.piece_map().items():
                if piece.color == opp_color and piece.piece_type in [chess.BISHOP, chess.ROOK, chess.QUEEN]:
                    ray_bb = chess.between(slider_sq, k_sq)
                    if ray_bb:
                        pieces_in_ray = [sq for sq in chess.SquareSet(ray_bb) if board.piece_at(sq) is not None]
                        if len(pieces_in_ray) == 1:
                            pinned_sq = pieces_in_ray[0]
                            pinned_p = board.piece_at(pinned_sq)
                            if pinned_p and pinned_p.color == color:
                                pins.append(
                                    f"Absolute Pin: {opp_name}'s {chess.piece_name(piece.piece_type)} on "
                                    f"{chess.square_name(slider_sq)} pins {color_name}'s "
                                    f"{chess.piece_name(pinned_p.piece_type)} on {chess.square_name(pinned_sq)} against the King."
                                )
        return pins

    # Detects fork motifs on board
    @staticmethod
    def _detect_forks(board: chess.Board):
        forks = []
        for sq, piece in board.piece_map().items():
            opp_color = not piece.color
            color_name = "White" if piece.color == chess.WHITE else "Black"
            opp_name = "Black" if piece.color == chess.WHITE else "White"

            attacked_squares = board.attacks(sq)
            targets = []
            for a_sq in attacked_squares:
                att_p = board.piece_at(a_sq)
                if att_p and att_p.color == opp_color:
                    if att_p.piece_type in [chess.KING, chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT]:
                        targets.append((a_sq, att_p))

            if len(targets) >= 2:
                target_names = [
                    f"{opp_name} {chess.piece_name(t[1].piece_type)} on {chess.square_name(t[0])}"
                    for t in targets[:2]
                ]
                has_king = any(t[1].piece_type == chess.KING for t in targets)
                has_queen = any(t[1].piece_type == chess.QUEEN for t in targets)

                if has_king and has_queen:
                    forks.append(
                        f"Royal Fork: {color_name} {chess.piece_name(piece.piece_type)} on "
                        f"{chess.square_name(sq)} forks the King and Queen!"
                    )
                else:
                    forks.append(
                        f"Double Attack / Fork: {color_name} {chess.piece_name(piece.piece_type)} on "
                        f"{chess.square_name(sq)} attacks both {' and '.join(target_names)}."
                    )
        return forks

    # Detects skewer motifs on board
    @staticmethod
    def _detect_skewers(board: chess.Board):
        skewers = []
        for sq, piece in board.piece_map().items():
            if piece.piece_type in [chess.BISHOP, chess.ROOK, chess.QUEEN]:
                opp_color = not piece.color
                color_name = "White" if piece.color == chess.WHITE else "Black"
                opp_name = "Black" if piece.color == chess.WHITE else "White"

                directions = []
                f = chess.square_file(sq)
                r = chess.square_rank(sq)

                if piece.piece_type in [chess.ROOK, chess.QUEEN]:
                    directions.extend([(0, 1), (0, -1), (1, 0), (-1, 0)])
                if piece.piece_type in [chess.BISHOP, chess.QUEEN]:
                    directions.extend([(1, 1), (1, -1), (-1, 1), (-1, -1)])

                for df, dr in directions:
                    cf, cr = f + df, r + dr
                    seen_targets = []
                    while 0 <= cf < 8 and 0 <= cr < 8:
                        cur_sq = chess.square(cf, cr)
                        p = board.piece_at(cur_sq)
                        if p:
                            if p.color == opp_color:
                                seen_targets.append((cur_sq, p))
                            else:
                                break
                        cf += df
                        cr += dr

                    if len(seen_targets) >= 2:
                        first_sq, first_p = seen_targets[0]
                        second_sq, second_p = seen_targets[1]
                        val_1 = PIECE_VALUES.get(first_p.piece_type, 0)
                        val_2 = PIECE_VALUES.get(second_p.piece_type, 0)
                        if val_1 > val_2 and val_1 >= 500:
                            skewers.append(
                                f"Skewer: {color_name} {chess.piece_name(piece.piece_type)} on "
                                f"{chess.square_name(sq)} skewers {opp_name}'s "
                                f"{chess.piece_name(first_p.piece_type)} on {chess.square_name(first_sq)} "
                                f"through to {chess.piece_name(second_p.piece_type)} on {chess.square_name(second_sq)}."
                            )
        return skewers

    # Detects discovered attacks for move
    @staticmethod
    def _detect_discovered(board: chess.Board, move: chess.Move):
        disc = []
        if not move or not isinstance(move, chess.Move):
            return disc
        from_sq = move.from_square
        try:
            temp_board = board.copy()
            temp_board.push(move)

            opp_color = not board.turn
            if temp_board.is_check():
                k_sq = temp_board.king(opp_color)
                if k_sq is not None:
                    attackers = temp_board.attackers(board.turn, k_sq)
                    if move.to_square not in attackers and len(attackers) > 0:
                        disc.append(
                            f"Discovered Check: Vacating {chess.square_name(from_sq)} "
                            f"unmasks a direct check against the King!"
                        )
        except Exception:
            pass
        return disc

    # Detects back-rank weaknesses on board
    @staticmethod
    def _detect_back_rank(board: chess.Board):
        notes = []
        for color in [chess.WHITE, chess.BLACK]:
            k_sq = board.king(color)
            if k_sq is not None:
                back_rank = 0 if color == chess.WHITE else 7
                shield_rank = 1 if color == chess.WHITE else 6
                if chess.square_rank(k_sq) == back_rank:
                    k_file = chess.square_file(k_sq)
                    shield_pawns = 0
                    for f in [k_file - 1, k_file, k_file + 1]:
                        if 0 <= f < 8:
                            sq = chess.square(f, shield_rank)
                            p = board.piece_at(sq)
                            if p and p.piece_type == chess.PAWN and p.color == color:
                                shield_pawns += 1
                    if shield_pawns == 3 and not board.has_kingside_castling_rights(color) and not board.has_queenside_castling_rights(color):
                        color_name = "White" if color == chess.WHITE else "Black"
                        notes.append(
                            f"Back-Rank Awareness: {color_name}'s king has a locked pawn shield; "
                            f"watch for back-rank mate threats (Luft)."
                        )
        return notes

    # Detects outpost squares on board
    @staticmethod
    def _detect_outposts(board: chess.Board):
        outposts = []
        for sq, piece in board.piece_map().items():
            if piece.piece_type == chess.KNIGHT:
                rank = chess.square_rank(sq)
                color = piece.color
                color_name = "White" if color == chess.WHITE else "Black"
                if (color == chess.WHITE and rank in [3, 4, 5]) or (color == chess.BLACK and rank in [2, 3, 4]):
                    defenders = board.attackers(color, sq)
                    has_pawn_defender = any(
                        board.piece_at(d) and board.piece_at(d).piece_type == chess.PAWN for d in defenders
                    )
                    if has_pawn_defender:
                        outposts.append(
                            f"Strong Knight Outpost: {color_name} knight on {chess.square_name(sq)} "
                            f"is anchored by a pawn and controls key central invasion squares."
                        )
        return outposts

# Provides progressive grandmaster hints
class HintSystem:

    # Returns progressive hints for position
    @staticmethod
    async def get_progressive_hints(fen: str, stockfish=None, depth: int = 12):
        board = chess.Board(fen)
        if board.is_game_over() or not list(board.legal_moves):
            return {"tier_1": "Game is over.", "tier_2": "Game is over.", "tier_3": "Game is over."}

        best_move_uci = None
        pv_line = ""
        if stockfish:
            try:
                best_move_uci = await stockfish.best_move(fen, depth=depth)
                top_moves = await stockfish.get_top_moves(fen, count=1, depth=depth)
                if top_moves:
                    pv_line = top_moves[0].get("pv_san", "")
            except Exception:
                best_move_uci = None

        if not best_move_uci:
            best_move = list(board.legal_moves)[0]
        else:
            best_move = chess.Move.from_uci(best_move_uci)

        from_sq = best_move.from_square
        to_sq = best_move.to_square
        moving_piece = board.piece_at(from_sq)
        piece_name = chess.piece_name(moving_piece.piece_type) if moving_piece else "piece"
        opp_str = "Black" if board.turn == chess.WHITE else "White"

        target_piece = board.piece_at(to_sq)
        temp_board = board.copy()
        temp_board.push(best_move)
        is_check = temp_board.is_check()
        is_capture = target_piece is not None
        is_castle = board.is_castling(best_move)

        motifs = TacticalMotifDetector.detect_motifs(board, best_move)

        if is_check:
            tier_1 = f"Look for a high-impact, forcing move that directly challenges {opp_str}'s king safety."
        elif is_capture:
            tier_1 = "There is an opportunity to win material or make a favorable tactical trade."
        elif is_castle:
            tier_1 = "Focus on king safety and connecting your back-rank heavy pieces."
        elif to_sq in [chess.D4, chess.E4, chess.D5, chess.E5]:
            tier_1 = "Look for a way to stake a powerful claim on the central squares."
        elif moving_piece and moving_piece.piece_type in [chess.KNIGHT, chess.BISHOP]:
            tier_1 = "Activate an undeveloped minor piece to improve coordination."
        else:
            tier_1 = "Look to optimize the dynamic activity of your least active piece."

        if motifs:
            tier_2 = f"Tactical Idea: Look around the {chess.square_name(to_sq)} area for: {motifs[0]}"
        elif is_capture:
            tier_2 = f"Consider attacking or capturing on {chess.square_name(to_sq)} with your {piece_name}."
        elif is_castle:
            tier_2 = "Castle your king immediately to neutralize any king-side infiltration."
        elif moving_piece:
            tier_2 = f"Find the most active square for your {piece_name} on {chess.square_name(from_sq)}."
        else:
            tier_2 = f"Focus your attention on the {chess.square_name(to_sq)} square."

        san_move = board.san(best_move)
        tier_3 = (
            f"Grandmaster Solution: Play **{san_move}** ({best_move.uci()})! "
            f"Continuation line: {pv_line if pv_line else san_move}"
        )

        return {
            "tier_1_conceptual": tier_1,
            "tier_2_tactical": tier_2,
            "tier_3_solution": tier_3,
            "best_move_san": san_move,
            "best_move_uci": best_move.uci(),
            "motifs": motifs,
        }

CONCEPTS = {
    "e2e4": {
        "concepts": ["Center Control", "Piece Development", "Opening Initiative"],
        "explanation": "Occupies the center with e4, opens diagonal lines for the king's bishop and queen, and claims vital space.",
    },
    "d2d4": {
        "concepts": ["Center Control", "Space Advantage", "Opening Initiative"],
        "explanation": "Claims central space with d4, opens lines for the dark-squared bishop, and establishes a solid pawn foundation.",
    },
    "g1f3": {
        "concepts": ["Piece Development", "Center Control", "King Safety"],
        "explanation": "Develops the knight towards the center, exerts pressure on e5 and d4, and prepares kingside castling.",
    },
    "b1c3": {
        "concepts": ["Piece Development", "Center Support"],
        "explanation": "Develops the queenside knight to c3, supporting central pawn advances and controlling d5.",
    },
    "c2c4": {
        "concepts": ["Center Control", "Space Advantage", "Flank Attack"],
        "explanation": "Exerts strong flank pressure against the central d5 square, controlling critical territory.",
    },
    "e1g1": {
        "concepts": ["King Safety", "Castling", "Rook Activation"],
        "explanation": "Castles kingside, shielding the king behind the pawn shield and activating the rook on the f-file.",
    },
    "e1c1": {
        "concepts": ["King Safety", "Castling", "Rook Activation"],
        "explanation": "Castles queenside, bringing the king to safety and placing the rook immediately onto the central d-file.",
    },
    "e8g8": {
        "concepts": ["King Safety", "Castling", "Rook Activation"],
        "explanation": "Black castles kingside, securing king safety and connecting the back-rank rooks.",
    },
    "e8c8": {
        "concepts": ["King Safety", "Castling", "Rook Activation"],
        "explanation": "Black castles queenside, securing the king and activating the heavy rook on the d-file.",
    },
}


# Returns strategic concepts for move
def get_concepts(move: str, board: chess.Board = None, move_obj: chess.Move = None, best_move_uci: str = None):
    if board is None:
        if move in CONCEPTS:
            return CONCEPTS[move]
        try:
            temp_b = chess.Board()
            mv = chess.Move.from_uci(move)
            if mv in temp_b.legal_moves:
                return _analyze_board_move(temp_b, mv, best_move_uci)
        except Exception:
            pass
        return {
            "concepts": ["Positional Maneuver"],
            "explanation": "Strategic continuation played to coordinate piece harmony and board presence.",
        }

    if move_obj is None:
        try:
            move_obj = chess.Move.from_uci(move)
        except Exception:
            return {"concepts": ["Positional Maneuver"], "explanation": "Strategic continuation played."}

    return _analyze_board_move(board, move_obj, best_move_uci)

# Analyzes move to extract tactical concepts
def _analyze_board_move(board: chess.Board, move: chess.Move, best_move_uci: str = None):
    if move not in board.legal_moves:
        return {"concepts": ["Positional Play"], "explanation": "Move played on the board."}

    moving_piece = board.piece_at(move.from_square)
    target_piece = board.piece_at(move.to_square)
    from_sq = move.from_square
    to_sq = move.to_square
    color = board.turn
    opp_color_name = "Black" if color == chess.WHITE else "White"
    piece_type = moving_piece.piece_type if moving_piece else chess.PAWN
    piece_name = chess.piece_name(piece_type).title()
    from_name = chess.square_name(from_sq)
    to_name = chess.square_name(to_sq)

    move_san = board.san(move)
    is_castling = board.is_castling(move)
    is_capture = board.is_capture(move)
    is_promo = bool(move.promotion)

    next_board = board.copy()
    next_board.push(move)
    is_checkmate = next_board.is_checkmate()
    is_check = next_board.is_check()

    concepts = []
    explanation = ""

    if is_checkmate:
        concepts.extend(["Checkmate", "King Attack"])
        explanation = f"Decisive checkmate! {move_san} leaves {opp_color_name}'s king with no legal escape."
    elif is_check:
        concepts.extend(["Forcing Check", "Initiative"])
        explanation = f"{move_san} delivers a forcing check against {opp_color_name}'s king, seizing the tempo and disrupting defense."
    elif is_castling:
        concepts.extend(["King Safety", "Castling", "Rook Activation"])
        side_str = "kingside" if chess.square_file(to_sq) > chess.square_file(from_sq) else "queenside"
        explanation = f"Castles {side_str}, safely tucking the king away and activating the rook toward the center."
    elif is_promo:
        promo_name = chess.piece_name(move.promotion).title() if move.promotion else "Queen"
        concepts.extend(["Pawn Promotion", "Material Advantage"])
        explanation = f"Promotes pawn on {to_name} to a {promo_name}, establishing overwhelming material advantage."
    elif is_capture:
        if target_piece:
            tgt_name = chess.piece_name(target_piece.piece_type).title()
            val_diff = PIECE_VALUES.get(target_piece.piece_type, 0) - PIECE_VALUES.get(piece_type, 0)
            if val_diff >= 0:
                concepts.extend(["Material Capture", "Tactical Win"])
                explanation = f"Captures {opp_color_name}'s {tgt_name.lower()} on {to_name}, winning valuable material."
            else:
                concepts.extend(["Tactical Exchange", "Piece Trade"])
                explanation = f"Exchanges {piece_name.lower()} for {opp_color_name}'s {tgt_name.lower()} on {to_name}, modifying the board structure."
        else:
            concepts.extend(["En Passant Capture", "Pawn Structure"])
            explanation = f"Executes en passant capture on {to_name}, eliminating opponent's advanced pawn."
    elif to_sq in [chess.D4, chess.E4, chess.D5, chess.E5]:
        concepts.extend(["Center Control", "Space Advantage"])
        if piece_type == chess.PAWN:
            explanation = f"Advances {from_name[0]}-pawn to {to_name}, staking a powerful claim on the center and opening lines."
        else:
            explanation = f"Places the {piece_name.lower()} on the critical central outpost {to_name}, dominating key squares."
    elif to_sq in [chess.C4, chess.F4, chess.C5, chess.F5]:
        concepts.extend(["Extended Center", "Flank Pressure"])
        explanation = f"Positions {piece_name.lower()} on {to_name}, applying strong peripheral pressure against the central squares."
    elif piece_type in [chess.KNIGHT, chess.BISHOP]:
        from_rank = chess.square_rank(from_sq)
        if (color == chess.WHITE and from_rank == 0) or (color == chess.BLACK and from_rank == 7):
            concepts.extend(["Piece Development", "Opening Initiative"])
            explanation = f"Develops the {piece_name.lower()} from {from_name} to {to_name}, clearing the back rank and coordinating pieces."
        else:
            concepts.extend(["Piece Activity", "Maneuvering"])
            explanation = f"Maneuvers {piece_name.lower()} to {to_name}, improving piece mobility and targeting opponent weaknesses."
    elif piece_type == chess.ROOK:
        file_idx = chess.square_file(to_sq)
        file_char = chr(97 + file_idx)
        has_friendly_pawns = any(
            p.piece_type == chess.PAWN and p.color == color
            for sq, p in board.piece_map().items() if chess.square_file(sq) == file_idx
        )
        has_enemy_pawns = any(
            p.piece_type == chess.PAWN and p.color != color
            for sq, p in board.piece_map().items() if chess.square_file(sq) == file_idx
        )
        if not has_friendly_pawns and not has_enemy_pawns:
            concepts.extend(["Open File Control", "Rook Activation"])
            explanation = f"Seizes the open {file_char}-file with the rook on {to_name}, establishing vertical dominance."
        elif not has_friendly_pawns:
            concepts.extend(["Semi-Open File Control", "Rook Pressure"])
            explanation = f"Activates rook along the semi-open {file_char}-file on {to_name}, pressuring opponent pawns."
        else:
            concepts.extend(["Rook Centralization", "Back Rank Defense"])
            explanation = f"Positions rook on {to_name}, reinforcing defenses and connecting heavy artillery."
    elif piece_type == chess.QUEEN:
        concepts.extend(["Queen Activity", "Central Pressure"])
        explanation = f"Mobilizes the queen to {to_name}, magnifying tactical threats across diagonals and files."
    elif piece_type == chess.PAWN:
        concepts.extend(["Pawn Structure", "Space Gain"])
        explanation = f"Pushes the {from_name[0]}-pawn to {to_name}, gaining board territory and strengthening pawn chains."
    elif piece_type == chess.KING:
        concepts.extend(["King Safety", "King Repositioning"])
        explanation = f"Repositioning the king to {to_name} to ensure safety or prepare for the endgame."

    if not concepts:
        concepts = ["Positional Maneuver"]
    if not explanation:
        explanation = f"Plays {move_san} ({from_name}->{to_name}), coordinating pieces and maintaining strategic balance."

    concepts = list(dict.fromkeys(concepts))

    return {"concepts": concepts, "explanation": explanation}

# Section analysis/evaluation


PST_PAWN = [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
]


PST_KNIGHT = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
]


PST_BISHOP = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  5,  0,  0,  5,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
]


PST_ROOK = [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0,
]


PST_QUEEN = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
]


PST_KING_MID = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
]


PST_KING_END = [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50,
]


PST_MAP = {
    chess.PAWN: PST_PAWN,
    chess.KNIGHT: PST_KNIGHT,
    chess.BISHOP: PST_BISHOP,
    chess.ROOK: PST_ROOK,
    chess.QUEEN: PST_QUEEN,
}


CORE_CENTER = [chess.D4, chess.E4, chess.D5, chess.E5]


EXTENDED_CENTER = [chess.C4, chess.D3, chess.E3, chess.F4, chess.C5, chess.D6, chess.E6, chess.F5]


# Evaluates move accuracy and classification
class EvaluationAnalyzer:

    # Converts centipawn score to win probability
    @staticmethod
    def win_probability(cp):
        from review import eval_to_win_prob as _w
        try:
            return round(_w(float(cp or 0.0)) * 100.0, 1)
        except Exception:
            return 50.0

    # Calculates accuracy from win probabilities
    @staticmethod
    def calculate_accuracy(win_prob_before, win_prob_after):
        from review import accuracy_from_wp_diff as _a
        return _a(win_prob_before, win_prob_after)

    # Classifies centipawn loss into label
    @staticmethod
    def classify_cp_loss(cp_loss):
        from review import classify_loss as _c
        label = _c(cp_loss)
        return "best_move" if label == "best" else label

    # Classifies centipawn loss via thresholds
    @staticmethod
    def classify(cp_loss):
        category = EvaluationAnalyzer.classify_cp_loss(cp_loss)
        messages = {
            "best_move": "You found the strongest move in the position.",
            "best": "You found the strongest move in the position.",
            "brilliant": "A brilliant strike — best move with real sacrifice or vision.",
            "excellent": "A very strong move with minimal loss.",
            "good": "A solid move, although stronger options existed.",
            "inaccuracy": "A reasonable move, but it slightly worsened your position.",
            "mistake": "This move significantly reduced your advantage or worsened your position.",
            "blunder": "A serious mistake that likely changed the course of the game.",
        }
        return {"category": category, "message": messages.get(category, "Move played.")}

# Scores positions across 11 strategic dimensions
class PositionalEvaluator:

    # Evaluates board position comprehensively
    @staticmethod
    def evaluate(fen):
        board = chess.Board(fen)

        phase_factor, phase_name = PositionalEvaluator._calc_game_phase(board)

        material_white, material_black = PositionalEvaluator._calc_material(board)
        pst_white, pst_black = PositionalEvaluator._calc_pst(board, phase_factor)
        mobility_white, mobility_black = PositionalEvaluator._calc_mobility(board)
        center_white, center_black = PositionalEvaluator._calc_center_control(board)
        king_white, king_black = PositionalEvaluator._calc_king_safety(board, phase_factor)
        pawn_white, pawn_black = PositionalEvaluator._calc_pawn_structure(board)
        hanging_white, hanging_black = PositionalEvaluator._calc_hanging_pieces(board)
        bishop_white, bishop_black = PositionalEvaluator._calc_bishop_pair(board)
        rook_white, rook_black = PositionalEvaluator._calc_rook_activity(board)
        space_white, space_black = PositionalEvaluator._calc_space_advantage(board)
        knight_white, knight_black = PositionalEvaluator._calc_knight_outposts(board)

        total_white = (
            material_white + pst_white + mobility_white + center_white + king_white
            + pawn_white + hanging_white + bishop_white + rook_white + space_white + knight_white
        )
        total_black = (
            material_black + pst_black + mobility_black + center_black + king_black
            + pawn_black + hanging_black + bishop_black + rook_black + space_black + knight_black
        )

        net_cp = total_white - total_black
        net_pawns = round(net_cp / 100.0, 2)

        if board.is_checkmate():
            if board.turn == chess.WHITE:
                win_probs = {"white": 0.0, "draw": 0.0, "black": 100.0, "white_expected_score": 0.0}
                net_pawns = -100.0
                verdict = "Checkmate! Black wins the game."
            else:
                win_probs = {"white": 100.0, "draw": 0.0, "black": 0.0, "white_expected_score": 100.0}
                net_pawns = 100.0
                verdict = "Checkmate! White wins the game."
        elif board.is_game_over():
            win_probs = {"white": 0.0, "draw": 100.0, "black": 0.0, "white_expected_score": 50.0}
            net_pawns = 0.0
            verdict = "Game Over! Drawn match."
        else:
            win_probs = PositionalEvaluator._calc_win_probabilities(net_cp)
            if net_pawns > 2.0:
                verdict = "White has a decisive positional advantage."
            elif net_pawns > 0.8:
                verdict = "White holds a clear positional advantage."
            elif net_pawns > 0.3:
                verdict = "White has a slight positional edge."
            elif net_pawns >= -0.3:
                verdict = "The position is roughly balanced."
            elif net_pawns >= -0.8:
                verdict = "Black has a slight positional edge."
            elif net_pawns >= -2.0:
                verdict = "Black holds a clear positional advantage."
            else:
                verdict = "Black has a decisive positional advantage."

        parameters = {
            "material": {"name": "Material Advantage", "white": material_white, "black": material_black,
                         "diff": material_white - material_black, "description": "Total value of pieces on the board."},
            "piece_placement": {"name": "Piece Placement & Activity", "white": pst_white, "black": pst_black,
                                "diff": pst_white - pst_black, "description": "Positional quality of pieces relative to optimal squares."},
            "mobility": {"name": "Piece Mobility", "white": mobility_white, "black": mobility_black,
                         "diff": mobility_white - mobility_black, "description": "Total number of active, legal squares accessible by pieces."},
            "center_control": {"name": "Center Control", "white": center_white, "black": center_black,
                               "diff": center_white - center_black, "description": "Control and occupation of d4, e4, d5, e5 squares."},
            "king_safety": {"name": "King Safety & Castling", "white": king_white, "black": king_black,
                            "diff": king_white - king_black, "description": "Pawn shield integrity, castling status, and absence of attacker rays."},
            "pawn_structure": {"name": "Pawn Structure", "white": pawn_white, "black": pawn_black,
                               "diff": pawn_white - pawn_black, "description": "Bonuses for passed pawns and penalties for doubled/isolated pawns."},
            "tactical_defense": {"name": "Tactical Defense & Hanging Pieces", "white": hanging_white, "black": hanging_black,
                                 "diff": hanging_white - hanging_black, "description": "Defensive piece coordination and vulnerability to captures."},
            "bishop_pair": {"name": "Bishop Pair Dominance", "white": bishop_white, "black": bishop_black,
                            "diff": bishop_white - bishop_black, "description": "Long-diagonal dual bishop synergy and diagonal control."},
            "rook_open_files": {"name": "Rook Open Files & 7th Rank", "white": rook_white, "black": rook_black,
                                "diff": rook_white - rook_black, "description": "Rooks positioned on open files, semi-open files, or the 7th rank."},
            "space_advantage": {"name": "Space & Territorial Control", "white": space_white, "black": space_black,
                                "diff": space_white - space_black, "description": "Number of squares controlled in the opponent's territory."},
            "knight_outposts": {"name": "Knight Outposts & Strongholds", "white": knight_white, "black": knight_black,
                                "diff": knight_white - knight_black, "description": "Centrally anchored knights protected by pawns and immune to pawn attack."},
        }

        strategic_insights = PositionalEvaluator._generate_strategic_insights(board, parameters, net_pawns)

        return {
            "fen": fen,
            "turn": "White" if board.turn == chess.WHITE else "Black",
            "game_phase": phase_name,
            "phase_progress": round(phase_factor, 2),
            "net_score_pawns": net_pawns,
            "net_score_centipawns": int(net_cp),
            "win_probabilities": win_probs,
            "verdict": verdict,
            "strategic_insights": strategic_insights,
            "parameters": parameters,
            "totals": {"white": int(total_white), "black": int(total_black)},
        }

    # Calculates game phase factor from material
    @staticmethod
    def _calc_game_phase(board):
        npm = 0
        for sq, piece in board.piece_map().items():
            if piece.piece_type not in [chess.PAWN, chess.KING]:
                npm += PIECE_VALUES.get(piece.piece_type, 0)
        phase_factor = min(1.0, max(0.0, npm / 6400.0))
        if phase_factor > 0.70:
            phase_name = "Opening"
        elif phase_factor > 0.30:
            phase_name = "Middlegame"
        else:
            phase_name = "Endgame"
        return phase_factor, phase_name

    # Calculates material balance in pawns
    @staticmethod
    def _calc_material(board):
        w_mat = 0
        b_mat = 0
        for sq, piece in board.piece_map().items():
            if piece.piece_type == chess.KING:
                continue
            val = PIECE_VALUES.get(piece.piece_type, 0)
            if piece.color == chess.WHITE:
                w_mat += val
            else:
                b_mat += val
        return w_mat, b_mat

    # Calculates piece-square table score
    @staticmethod
    def _calc_pst(board, phase_factor):
        w_pst = 0
        b_pst = 0
        for sq, piece in board.piece_map().items():
            rank = chess.square_rank(sq)
            file = chess.square_file(sq)
            if piece.piece_type == chess.KING:
                idx_w = (7 - rank) * 8 + file
                idx_b = rank * 8 + file
                k_mid_w = PST_KING_MID[idx_w]
                k_end_w = PST_KING_END[idx_w]
                k_mid_b = PST_KING_MID[idx_b]
                k_end_b = PST_KING_END[idx_b]
                w_pst += int(phase_factor * k_mid_w + (1.0 - phase_factor) * k_end_w)
                b_pst += int(phase_factor * k_mid_b + (1.0 - phase_factor) * k_end_b)
                continue
            table = PST_MAP.get(piece.piece_type)
            if not table:
                continue
            if piece.color == chess.WHITE:
                idx = (7 - rank) * 8 + file
                w_pst += table[idx]
            else:
                idx = rank * 8 + file
                b_pst += table[idx]
        return w_pst, b_pst

    # Calculates mobility advantage for side
    @staticmethod
    def _calc_mobility(board):
        orig_turn = board.turn
        board.turn = chess.WHITE
        w_moves = len(list(board.legal_moves))
        board.turn = chess.BLACK
        b_moves = len(list(board.legal_moves))
        board.turn = orig_turn
        return w_moves * 4, b_moves * 4

    # Calculates central control score
    @staticmethod
    def _calc_center_control(board):
        w_center = 0
        b_center = 0
        for sq in CORE_CENTER:
            w_center += len(board.attackers(chess.WHITE, sq)) * 20
            b_center += len(board.attackers(chess.BLACK, sq)) * 20
            occ = board.piece_at(sq)
            if occ:
                if occ.color == chess.WHITE:
                    w_center += 25
                else:
                    b_center += 25
        for sq in EXTENDED_CENTER:
            w_center += len(board.attackers(chess.WHITE, sq)) * 8
            b_center += len(board.attackers(chess.BLACK, sq)) * 8
        return w_center, b_center

    # Calculates king safety score
    @staticmethod
    def _calc_king_safety(board, phase_factor):
        w_king_sq = board.king(chess.WHITE)
        b_king_sq = board.king(chess.BLACK)
        w_safety = 0
        b_safety = 0

        if w_king_sq is not None:
            w_rank = chess.square_rank(w_king_sq)
            w_file = chess.square_file(w_king_sq)
            if w_king_sq in [chess.G1, chess.C1]:
                w_safety += 35
            for f in range(max(0, w_file - 1), min(8, w_file + 2)):
                for r in range(w_rank + 1, min(8, w_rank + 3)):
                    p = board.piece_at(chess.square(f, r))
                    if p and p.piece_type == chess.PAWN and p.color == chess.WHITE:
                        w_safety += 20
            surrounding = chess.SquareSet(chess.BB_KING_ATTACKS[w_king_sq])
            for sq in surrounding:
                if board.is_attacked_by(chess.BLACK, sq):
                    w_safety -= 15

        if b_king_sq is not None:
            b_rank = chess.square_rank(b_king_sq)
            b_file = chess.square_file(b_king_sq)
            if b_king_sq in [chess.G8, chess.C8]:
                b_safety += 35
            for f in range(max(0, b_file - 1), min(8, b_file + 2)):
                for r in range(max(0, b_rank - 2), b_rank):
                    p = board.piece_at(chess.square(f, r))
                    if p and p.piece_type == chess.PAWN and p.color == chess.BLACK:
                        b_safety += 20
            surrounding = chess.SquareSet(chess.BB_KING_ATTACKS[b_king_sq])
            for sq in surrounding:
                if board.is_attacked_by(chess.WHITE, sq):
                    b_safety -= 15

        return int(w_safety * phase_factor), int(b_safety * phase_factor)

    # Calculates pawn structure score
    @staticmethod
    def _calc_pawn_structure(board):
        w_pawn_score = 0
        b_pawn_score = 0
        w_pawns = board.pieces(chess.PAWN, chess.WHITE)
        b_pawns = board.pieces(chess.PAWN, chess.BLACK)
        w_files = [chess.square_file(sq) for sq in w_pawns]
        b_files = [chess.square_file(sq) for sq in b_pawns]

        for f in range(8):
            if w_files.count(f) > 1:
                w_pawn_score -= 20 * (w_files.count(f) - 1)
            if b_files.count(f) > 1:
                b_pawn_score -= 20 * (b_files.count(f) - 1)

        for f in set(w_files):
            if ((f - 1) not in w_files) and ((f + 1) not in w_files):
                w_pawn_score -= 25
        for f in set(b_files):
            if ((f - 1) not in b_files) and ((f + 1) not in b_files):
                b_pawn_score -= 25

        for sq in w_pawns:
            r = chess.square_rank(sq)
            f = chess.square_file(sq)
            is_passed = True
            for opp_sq in b_pawns:
                opp_r = chess.square_rank(opp_sq)
                opp_f = chess.square_file(opp_sq)
                if abs(opp_f - f) <= 1 and opp_r > r:
                    is_passed = False
                    break
            if is_passed:
                w_pawn_score += 20 + (r * 12)

        for sq in b_pawns:
            r = chess.square_rank(sq)
            f = chess.square_file(sq)
            is_passed = True
            for opp_sq in w_pawns:
                opp_r = chess.square_rank(opp_sq)
                opp_f = chess.square_file(opp_sq)
                if abs(opp_f - f) <= 1 and opp_r < r:
                    is_passed = False
                    break
            if is_passed:
                b_pawn_score += 20 + ((7 - r) * 12)

        return w_pawn_score, b_pawn_score

    # Calculates hanging piece penalties
    @staticmethod
    def _calc_hanging_pieces(board):
        w_score = 0
        b_score = 0
        for sq, piece in board.piece_map().items():
            if piece.piece_type == chess.KING:
                continue
            val = PIECE_VALUES.get(piece.piece_type, 0)
            if piece.color == chess.WHITE:
                attackers = board.attackers(chess.BLACK, sq)
                defenders = board.attackers(chess.WHITE, sq)
                if attackers and not defenders:
                    w_score -= val // 2
                elif attackers:
                    min_att_val = min(
                        [PIECE_VALUES.get(board.piece_at(a).piece_type, 0) for a in attackers if board.piece_at(a)] or [val]
                    )
                    if min_att_val < val:
                        w_score -= (val - min_att_val) // 2
            else:
                attackers = board.attackers(chess.WHITE, sq)
                defenders = board.attackers(chess.BLACK, sq)
                if attackers and not defenders:
                    b_score -= val // 2
                elif attackers:
                    min_att_val = min(
                        [PIECE_VALUES.get(board.piece_at(a).piece_type, 0) for a in attackers if board.piece_at(a)] or [val]
                    )
                    if min_att_val < val:
                        b_score -= (val - min_att_val) // 2
        return w_score, b_score

    # Calculates bishop pair bonus
    @staticmethod
    def _calc_bishop_pair(board):
        w_bishops = len(board.pieces(chess.BISHOP, chess.WHITE))
        b_bishops = len(board.pieces(chess.BISHOP, chess.BLACK))
        return (35 if w_bishops >= 2 else 0), (35 if b_bishops >= 2 else 0)

    # Calculates rook activity score
    @staticmethod
    def _calc_rook_activity(board):
        w_score = 0
        b_score = 0
        w_pawns = board.pieces(chess.PAWN, chess.WHITE)
        b_pawns = board.pieces(chess.PAWN, chess.BLACK)
        w_p_files = {chess.square_file(sq) for sq in w_pawns}
        b_p_files = {chess.square_file(sq) for sq in b_pawns}

        for sq in board.pieces(chess.ROOK, chess.WHITE):
            f = chess.square_file(sq)
            r = chess.square_rank(sq)
            if f not in w_p_files and f not in b_p_files:
                w_score += 25
            elif f not in w_p_files:
                w_score += 15
            if r == 6:
                w_score += 35

        for sq in board.pieces(chess.ROOK, chess.BLACK):
            f = chess.square_file(sq)
            r = chess.square_rank(sq)
            if f not in w_p_files and f not in b_p_files:
                b_score += 25
            elif f not in b_p_files:
                b_score += 15
            if r == 1:
                b_score += 35

        return w_score, b_score

    # Calculates space advantage score
    @staticmethod
    def _calc_space_advantage(board):
        w_space = 0
        b_space = 0
        for r in range(4, 8):
            for f in range(8):
                if board.is_attacked_by(chess.WHITE, chess.square(f, r)):
                    w_space += 3
        for r in range(0, 4):
            for f in range(8):
                if board.is_attacked_by(chess.BLACK, chess.square(f, r)):
                    b_space += 3
        return w_space, b_space

    # Calculates knight outpost bonus
    @staticmethod
    def _calc_knight_outposts(board):
        w_score = 0
        b_score = 0
        for sq in board.pieces(chess.KNIGHT, chess.WHITE):
            r = chess.square_rank(sq)
            if r in [3, 4, 5]:
                defenders = board.attackers(chess.WHITE, sq)
                if any(board.piece_at(d) and board.piece_at(d).piece_type == chess.PAWN for d in defenders):
                    w_score += 30
        for sq in board.pieces(chess.KNIGHT, chess.BLACK):
            r = chess.square_rank(sq)
            if r in [2, 3, 4]:
                defenders = board.attackers(chess.BLACK, sq)
                if any(board.piece_at(d) and board.piece_at(d).piece_type == chess.PAWN for d in defenders):
                    b_score += 30
        return w_score, b_score

    # Converts pawn diff to win probabilities
    @staticmethod
    def _calc_win_probabilities(cp_diff):
        win_w = 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-0.00368208 * cp_diff)) - 1.0)
        win_w = max(0.0, min(100.0, win_w))
        draw_prob = max(5.0, 35.0 * math.exp(-0.000008 * (cp_diff ** 2)))
        remaining = 100.0 - draw_prob
        white_prob = round((win_w / 100.0) * remaining, 1)
        black_prob = round(((100.0 - win_w) / 100.0) * remaining, 1)
        draw_prob = round(100.0 - (white_prob + black_prob), 1)
        return {"white": white_prob, "draw": draw_prob, "black": black_prob, "white_expected_score": round(win_w, 1)}

    # Generates strategic insights from parameters
    @staticmethod
    def _generate_strategic_insights(board, params, net_pawns):
        insights = []
        mat_diff = params["material"]["diff"]
        if abs(mat_diff) >= 300:
            leader = "White" if mat_diff > 0 else "Black"
            insights.append(f"{leader} holds decisive material superiority ({abs(mat_diff)//100} pawns).")
        elif abs(mat_diff) >= 100:
            leader = "White" if mat_diff > 0 else "Black"
            insights.append(f"{leader} is ahead by a pawn in material count.")

        bp_diff = params["bishop_pair"]["diff"]
        if bp_diff > 0:
            insights.append("White controls both bishops (Bishop Pair advantage).")
        elif bp_diff < 0:
            insights.append("Black holds the powerful Bishop Pair advantage.")

        rk_diff = params["rook_open_files"]["diff"]
        if rk_diff >= 25:
            insights.append("White dominates key open vertical files with active rooks.")
        elif rk_diff <= -25:
            insights.append("Black has established strong open file rook pressure.")

        center_diff = params["center_control"]["diff"]
        if center_diff >= 40:
            insights.append("White exercises firm control over central squares (d4, e4, d5, e5).")
        elif center_diff <= -40:
            insights.append("Black dominates central squares with active piece pressure.")

        space_diff = params["space_advantage"]["diff"]
        if space_diff >= 20:
            insights.append("White enjoys a territorial space advantage in enemy camp.")
        elif space_diff <= -20:
            insights.append("Black commands superior territorial board space.")

        king_diff = params["king_safety"]["diff"]
        if king_diff <= -30:
            insights.append("White's king safety is compromised with open attacking avenues.")
        elif king_diff >= 30:
            insights.append("Black's king is vulnerable to direct attacking lines.")

        if not insights:
            insights.append("Position remains balanced with equal positional play and dynamic tension.")

        return insights

# Section coaching/move_coaching

# Generates move feedback from classification
class FeedbackGenerator:

    # Generates feedback for classified move
    @staticmethod
    def generate(player_move, stockfish_move, cp_loss, classification):
        category = classification["category"]

        feedback = {
            "best_move": (
                f"You played {player_move}, which is one of the strongest moves available. "
                f"Your centipawn loss was only {cp_loss:.1f}."
            ),
            "excellent": (
                f"You played {player_move}. "
                f"The move is very close to the best line. "
                f"Centipawn loss: {cp_loss:.1f}."
            ),
            "good": (
                f"You played {player_move}. "
                f"It is a solid choice, but {stockfish_move} was stronger. "
                f"Centipawn loss: {cp_loss:.1f}."
            ),
            "inaccuracy": (
                f"You played {player_move}. "
                f"The move is playable, but stronger alternatives existed. "
                f"The strongest move was {stockfish_move}. "
                f"Centipawn loss: {cp_loss:.1f}."
            ),
            "mistake": (
                f"You played {player_move}. "
                f"This move noticeably weakened your position. "
                f"{stockfish_move} was the stronger choice. "
                f"Centipawn loss: {cp_loss:.1f}."
            ),
            "blunder": (
                f"You played {player_move}. "
                f"This move caused a major deterioration in the position. "
                f"{stockfish_move} was far stronger. "
                f"Centipawn loss: {cp_loss:.1f}."
            ),
        }

        return feedback.get(category, f"You played {player_move}. Centipawn loss: {cp_loss:.1f}.")

# Generates quick lessons from classifications
class LessonGenerator:

    # Generates lesson from move classification
    @staticmethod
    def generate(player_move, stockfish_move, cp_loss, classification):
        from intelligence import get_concepts

        concept_data = get_concepts(player_move)
        feedback = FeedbackGenerator.generate(
            player_move=player_move,
            stockfish_move=stockfish_move,
            cp_loss=cp_loss,
            classification=classification,
        )

        return {
            "move": player_move,
            "classification": classification["category"],
            "centipawn_loss": cp_loss,
            "concepts": concept_data["concepts"],
            "explanation": concept_data["explanation"],
            "feedback": feedback,
        }

# Explains moves with pedagogical coaching narrative
class MoveExplainer:

    # Explains move with strengths and defects
    @staticmethod
    async def explain(fen, player_move_uci, best_move_uci, cp_loss, classification, stockfish=None):
        board = chess.Board(fen)

        try:
            player_move = chess.Move.from_uci(player_move_uci) if player_move_uci else None
        except Exception:
            player_move = None

        try:
            best_move = chess.Move.from_uci(best_move_uci) if best_move_uci else None
        except Exception:
            best_move = None

        player_move_san = board.san(player_move) if player_move and player_move in board.legal_moves else (player_move_uci or "")
        best_move_san = board.san(best_move) if best_move and best_move in board.legal_moves else (best_move_uci or "")

        active_motifs = TacticalMotifDetector.detect_motifs(board, player_move)

        move_reasons, pv_continuation, move_themes, move_summary = await MoveExplainer._analyze_current_move_strengths(
            board, player_move, stockfish
        )

        thing_1 = {
            "title": f"Strategic Purpose & Goals ({player_move_san})",
            "move_uci": player_move_uci,
            "move_san": player_move_san,
            "reasons": move_reasons,
            "tactical_themes": move_themes,
            "active_motifs": active_motifs,
            "continuation": pv_continuation,
            "summary": move_summary,
        }

        has_defects, flaw_type, defect_summary, rejection_reasons, future_steps, future_summary = (
            await MoveExplainer._analyze_current_move_defects(
                board, player_move, best_move, cp_loss, classification, stockfish
            )
        )

        thing_2 = {
            "title": f"Move Defects & Flaws ({player_move_san})",
            "move_uci": player_move_uci,
            "move_san": player_move_san,
            "has_defects": has_defects,
            "is_optimal": not has_defects,
            "flaw_type": flaw_type,
            "reasons_to_avoid": rejection_reasons,
            "future_consequences": {"summary": future_summary, "step_by_step": future_steps},
            "summary": defect_summary,
        }

        positional_data = PositionalEvaluator.evaluate(fen)
        best_reasons, best_pv_continuation, _ = await MoveExplainer._analyze_move_goals(board, best_move, stockfish)

        return {
            "thing_1": thing_1,
            "thing_2": thing_2,
            "best_move": {
                "uci": best_move_uci,
                "san": best_move_san,
                "reasons": best_reasons,
                "continuation": best_pv_continuation,
                "summary": f"Playing {best_move_san} is the top recommendation.",
            },
            "human_move": {
                "uci": player_move_uci,
                "san": player_move_san,
                "category": classification.get("category", "unknown") if classification else "unknown",
                "cp_loss": cp_loss,
                "rejection_reasons": rejection_reasons,
                "future_impact": future_summary,
                "summary": defect_summary,
            },
            "judging_parameters": positional_data["parameters"],
            "board_evaluation": {
                "verdict": positional_data["verdict"],
                "net_score_pawns": positional_data["net_score_pawns"],
                "turn": positional_data["turn"],
            },
        }

    # Analyzes strengths of current move
    @staticmethod
    async def _analyze_current_move_strengths(board, move, stockfish):
        reasons, continuation_str, themes = await MoveExplainer._analyze_move_goals(board, move, stockfish)
        move_san = board.san(move) if move and move in board.legal_moves else (move.uci() if move else "this move")

        if reasons:
            summary = f"Playing {move_san} {reasons[0].lower()}."
        else:
            summary = f"Playing {move_san} maintains piece harmony and active board presence."
            reasons = ["Maintains active piece mobility and preserves strategic balance."]

        return reasons, continuation_str, themes, summary

    # Analyzes strategic goals of move
    @staticmethod
    async def _analyze_move_goals(board, move, stockfish):
        reasons = []
        themes = []
        continuation_str = ""

        if not move or move not in board.legal_moves:
            return ["Move is not legal on the current board."], "", ["Illegal"]

        moving_piece = board.piece_at(move.from_square)
        target_piece = board.piece_at(move.to_square)
        to_sq = move.to_square
        from_sq = move.from_square
        opp_str = "Black" if board.turn == chess.WHITE else "White"

        temp_board = board.copy()
        temp_board.push(move)

        if temp_board.is_checkmate():
            reasons.append("Delivers an immediate, unstoppable CHECKMATE!")
            themes.append("Checkmate")
        elif temp_board.is_check():
            reasons.append(f"Delivers a forcing check against {opp_str}'s king, seizing the tempo and disrupting defense")
            themes.append("Forcing Check")

        if target_piece:
            val_diff = PIECE_VALUES.get(target_piece.piece_type, 0) - (PIECE_VALUES.get(moving_piece.piece_type, 0) if moving_piece else 0)
            if val_diff >= 0:
                reasons.append(
                    f"Captures {opp_str}'s {chess.piece_name(target_piece.piece_type)} on "
                    f"{chess.square_name(to_sq)}, securing material advantage"
                )
                themes.append("Material Gain")
            else:
                reasons.append(
                    f"Executes tactical capture on {chess.square_name(to_sq)} to relieve tension and open lines"
                )
                themes.append("Tactical Exchange")

        if to_sq in [chess.D4, chess.E4, chess.D5, chess.E5]:
            reasons.append(f"Occupies and controls the critical central square {chess.square_name(to_sq)}, dictating board flow")
            themes.append("Center Control")
        elif to_sq in [chess.C4, chess.F4, chess.C5, chess.F5]:
            reasons.append(f"Exerts strong peripheral pressure on the center from {chess.square_name(to_sq)}")
            themes.append("Extended Center")

        if moving_piece and moving_piece.piece_type in [chess.KNIGHT, chess.BISHOP]:
            from_rank = chess.square_rank(from_sq)
            if (board.turn == chess.WHITE and from_rank == 0) or (board.turn == chess.BLACK and from_rank == 7):
                reasons.append(
                    f"Develops the {chess.piece_name(moving_piece.piece_type)} to an active post and clears back rank for castling"
                )
                themes.append("Piece Development")

        if board.is_castling(move):
            reasons.append("Tucks the king safely behind a protective pawn shield while activating the rook on a central file")
            themes.append("King Safety / Castling")

        for attacked_sq in temp_board.attacks(to_sq):
            att_piece = temp_board.piece_at(attacked_sq)
            if att_piece and att_piece.color != board.turn:
                if moving_piece and PIECE_VALUES.get(att_piece.piece_type, 0) >= PIECE_VALUES.get(moving_piece.piece_type, 0):
                    reasons.append(
                        f"Creates a direct tactical threat against opponent's "
                        f"{chess.piece_name(att_piece.piece_type)} on {chess.square_name(attacked_sq)}"
                    )
                    themes.append("Threat / Attack")

        if moving_piece and moving_piece.piece_type in [chess.ROOK, chess.QUEEN]:
            file_idx = chess.square_file(to_sq)
            has_friendly_pawns = any(
                p.piece_type == chess.PAWN and p.color == board.turn
                for sq, p in board.piece_map().items() if chess.square_file(sq) == file_idx
            )
            has_enemy_pawns = any(
                p.piece_type == chess.PAWN and p.color != board.turn
                for sq, p in board.piece_map().items() if chess.square_file(sq) == file_idx
            )
            if not has_friendly_pawns and not has_enemy_pawns:
                reasons.append(
                    f"Places the {chess.piece_name(moving_piece.piece_type)} on the fully open "
                    f"{chr(97 + file_idx)}-file, establishing vertical dominance"
                )
                themes.append("Open File Control")
            elif not has_friendly_pawns:
                reasons.append(
                    f"Places the {chess.piece_name(moving_piece.piece_type)} on the semi-open "
                    f"{chr(97 + file_idx)}-file to generate sustained pressure"
                )
                themes.append("Semi-Open File")

        if moving_piece and moving_piece.piece_type == chess.PAWN:
            if not any("Center" in t for t in themes):
                reasons.append(f"Advances pawn to {chess.square_name(to_sq)}, claiming space and strengthening pawn structure")
                themes.append("Space / Pawn Structure")

        if not reasons:
            reasons.append("Maintains active piece mobility and preserves strategic board stability")
            themes.append("Strategic Stability")

        if stockfish and not temp_board.is_game_over():
            try:
                top_moves = await stockfish.get_top_moves(temp_board.fen(), count=1, depth=18)
                if top_moves and top_moves[0].get("pv_san"):
                    continuation_str = top_moves[0]["pv_san"]
            except Exception:
                continuation_str = ""

        return reasons, continuation_str, list(set(themes))

    # Analyzes defects of current move
    @staticmethod
    async def _analyze_current_move_defects(board, player_move, best_move, cp_loss, classification, stockfish):
        reasons = []
        future_steps = []
        flaw_type = "Tactical / Positional"

        if not player_move or player_move not in board.legal_moves:
            return (True, "Illegal Move", "The selected move is not legal in this board position.",
                    ["Illegal move."], [], "Cannot compute future consequences for an illegal move.")

        cat = classification.get("category", "") if classification else ""
        is_sound_by_eval = (
            (best_move and player_move == best_move) or
            (cp_loss <= 20 and cat in ["best_move", "best", "excellent", "good", "book", "optimal"])
        )

        moving_piece = board.piece_at(player_move.from_square)
        to_sq = player_move.to_square
        from_sq = player_move.from_square
        opp_color = not board.turn
        friendly_color = board.turn
        piece_name = chess.piece_name(moving_piece.piece_type) if moving_piece else "piece"

        temp_board = board.copy()
        temp_board.push(player_move)

        has_tactical_flaw = False

        attackers = temp_board.attackers(opp_color, to_sq)
        defenders = temp_board.attackers(friendly_color, to_sq)

        if moving_piece and attackers and not defenders:
            has_tactical_flaw = True
            flaw_type = "Blunder: Hanging Piece"
            reasons.append(f"Leaves your {piece_name} completely hanging and undefended on {chess.square_name(to_sq)}.")
            att_sq = list(attackers)[0]
            future_steps.append(
                f"Step 1: Opponent immediately plays {chess.square_name(att_sq)}x{chess.square_name(to_sq)}, "
                f"capturing your {piece_name} for free."
            )
            future_steps.append("Step 2: You enter the following moves down material with no compensation.")
        elif moving_piece and attackers:
            min_att_piece = min(
                (temp_board.piece_at(a) for a in attackers if temp_board.piece_at(a)),
                key=lambda p: PIECE_VALUES.get(p.piece_type, 0),
                default=None,
            )
            if min_att_piece and PIECE_VALUES.get(min_att_piece.piece_type, 0) < PIECE_VALUES.get(moving_piece.piece_type, 0):
                has_tactical_flaw = True
                flaw_type = "Material Concession: Unfavorable Trade"
                reasons.append(
                    f"Allows unfavorable capture: your {piece_name} "
                    f"({PIECE_VALUES.get(moving_piece.piece_type, 0)} cp) can be captured by opponent's "
                    f"{chess.piece_name(min_att_piece.piece_type)} ({PIECE_VALUES.get(min_att_piece.piece_type, 0)} cp)."
                )
                future_steps.append(
                    f"Step 1: Opponent trades their {chess.piece_name(min_att_piece.piece_type)} "
                    f"for your more valuable {piece_name}."
                )
                future_steps.append("Step 2: The material imbalance leaves your remaining defense compromised.")

        for sq, piece in temp_board.piece_map().items():
            if piece.color == friendly_color and sq != to_sq:
                was_defended = board.is_attacked_by(friendly_color, sq)
                is_defended_now = temp_board.is_attacked_by(friendly_color, sq)
                is_attacked = temp_board.is_attacked_by(opp_color, sq)
                if was_defended and not is_defended_now and is_attacked:
                    has_tactical_flaw = True
                    flaw_type = "Tactical Defect: Stripped Defender"
                    reasons.append(
                        f"Vacating {chess.square_name(from_sq)} strips defense from your "
                        f"{chess.piece_name(piece.piece_type)} on {chess.square_name(sq)}."
                    )
                    future_steps.append(
                        f"Step 1: Opponent exploits the undefended piece on {chess.square_name(sq)} with an immediate strike."
                    )

        if moving_piece and moving_piece.piece_type == chess.PAWN:
            k_sq = board.king(friendly_color)
            if k_sq is not None and not is_sound_by_eval:
                if abs(chess.square_file(to_sq) - chess.square_file(k_sq)) <= 1:
                    flaw_type = "King Safety: Weakened Pawn Shelter"
                    reasons.append(
                        f"Pushes pawn away from king shelter, creating permanent weak squares around your king on {chess.square_name(k_sq)}."
                    )
                    future_steps.append("Step 1: Opponent targets the weakened squares with piece infiltration.")
                    future_steps.append("Step 2: King comes under sustained attack, compromising positional defense.")

        if moving_piece and moving_piece.piece_type == chess.KNIGHT and not is_sound_by_eval:
            to_file = chess.square_file(to_sq)
            if to_file in [0, 7]:
                flaw_type = "Positional Flaw: Knight on the Rim"
                reasons.append(
                    f"A knight on the rim ({chess.square_name(to_sq)}) is passive, "
                    f"controlling only 4 squares instead of up to 8 in the center."
                )
                future_steps.append("Step 1: The knight becomes marginalized and unable to participate in central defense.")

        best_san_str = board.san(best_move) if best_move and best_move in board.legal_moves else (best_move.uci() if best_move else "")
        if cp_loss > 300:
            flaw_type = "Severe Blunder"
            reasons.append(
                f"Severe blunder (+{cp_loss:.0f} centipawn swing). You missed the winning tactical line starting with {best_san_str}."
            )
        elif cp_loss > 100:
            flaw_type = "Mistake"
            reasons.append(f"Costly mistake (+{cp_loss:.0f} cp loss): hands the initiative to the opponent compared to {best_san_str}.")
        elif cp_loss > 20:
            flaw_type = "Inaccuracy"
            reasons.append(f"Inaccuracy (+{cp_loss:.0f} cp loss): concedes subtle advantage compared to {best_san_str}.")

        if (is_sound_by_eval or cp_loss <= 20) and not has_tactical_flaw:
            return (False, "No Defects", "This move has no defects.", [], [], "This move has no defects.")
        if not reasons and cp_loss <= 20:
            return (False, "No Defects", "This move has no defects.", [], [], "This move has no defects.")

        if not reasons:
            reasons.append(f"Suboptimal move (+{cp_loss:.0f} cp loss): surrenders tactical pressure compared to {best_san_str}.")

        if not future_steps:
            future_steps = [
                "Move 1 (Opponent): Seizes open lines and exerts pressure on your weakened squares.",
                "Move 2 (Opponent): Infiltrates pieces into your position, forcing passive defense.",
                "Move 3 (Consequence): Positional deterioration transforms into advantage for the opponent.",
            ]

        future_summary = (
            f"Why this leads to disadvantage: Over the next 2-4 moves, the opponent exploits the "
            f"{flaw_type.lower()} by launching a counter-attack, leaving you in a strategically compromised position."
        )

        defect_summary = f"Flaw identified: {reasons[0]}"

        return (True, flaw_type, defect_summary, reasons, future_steps, future_summary)

# Section coaching/game_coaching

try:
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False

_DATA_DIR = Path(__file__).resolve().parent / "data"


_DEFAULT_GM_PGN = _DATA_DIR / "grandmaster_games_1000.pgn"


# Re-exports review-match report helpers
from review import GameReport, GameSummary, WeaknessDetector, StyleAnalyzer
from review import TrainingPlan, OpeningRecommender, OpeningDetector

# Matches positions against GM game database
class GMHistoricalMatcher:

    # Initializes matcher with PGN data or path
    def __init__(self, pgn_data: str = None, pgn_path: str = None):
        self.game_positions = {}
        if pgn_path and os.path.exists(pgn_path):
            self._index_file(pgn_path)
        elif _DEFAULT_GM_PGN.exists():
            self._index_file(str(_DEFAULT_GM_PGN))
        else:
            self._index_games(pgn_data or SAMPLE_GM_PGNS)

    # Indexes GM games from file path
    def _index_file(self, file_path: str):
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                self._index_stream(f)
        except Exception:
            self._index_games(SAMPLE_GM_PGNS)

    # Indexes GM games from PGN string
    def _index_games(self, pgn_str: str):
        pgn_io = io.StringIO(pgn_str)
        self._index_stream(pgn_io)

    # Indexes GM games from stream
    def _index_stream(self, stream):
        game_count = 0
        seen_per_fen = {}
        while True:
            try:
                game = chess.pgn.read_game(stream)
                if game is None:
                    break
                white_player = game.headers.get("White", "Unknown GM")
                black_player = game.headers.get("Black", "Unknown GM")
                event = game.headers.get("Event", "Grandmaster Match")
                year = game.headers.get("Date", "????")[:4]
                game_key = (white_player, black_player, year)

                board = game.board()
                for move_num, node in enumerate(game.mainline(), start=1):
                    move = node.move
                    fen_key = board.epd()
                    if fen_key not in self.game_positions:
                        self.game_positions[fen_key] = []
                        seen_per_fen[fen_key] = set()
                    if game_key not in seen_per_fen[fen_key]:
                        seen_per_fen[fen_key].add(game_key)
                        self.game_positions[fen_key].append({
                            "white": white_player,
                            "black": black_player,
                            "event": event,
                            "year": year,
                            "move_san": None,
                            "move_uci": move.uci(),
                            "move_number": (move_num + 1) // 2,
                        })
                    board.push(move)
                game_count += 1
                if game_count >= 1000:
                    break
            except Exception:
                break

    # Finds GM games reaching board state
    def match_position(self, fen: str):
        try:
            board = chess.Board(fen)
            fen_key = board.epd()
            matches = self.game_positions.get(fen_key, [])
            if matches:
                distinct_matches = []
                seen_pairs = set()
                for m in matches:
                    pair_key = (m["white"], m["black"])
                    if pair_key not in seen_pairs:
                        seen_pairs.add(pair_key)
                        distinct_matches.append(m)
                    if len(distinct_matches) >= 4:
                        break
                if not distinct_matches:
                    distinct_matches = matches[:4]

                for m in distinct_matches:
                    if not m.get("move_san") and m.get("move_uci"):
                        try:
                            m["move_san"] = board.san(chess.Move.from_uci(m["move_uci"]))
                        except Exception:
                            m["move_san"] = m["move_uci"]
                m0 = distinct_matches[0]
                return {
                    "is_matched": True,
                    "count": len(matches),
                    "white": m0["white"],
                    "black": m0["black"],
                    "event": m0["event"],
                    "year": m0["year"],
                    "gm_move_san": m0["move_san"],
                    "gm_move_uci": m0["move_uci"],
                    "matched_games": distinct_matches,
                    "description": (
                        f"Historic Match: This position occurred in {m0['white']} vs {m0['black']} "
                        f"({m0['event']}, {m0['year']}). The Grandmaster played {m0['move_san']}!"
                    ),
                }
        except Exception:
            pass

        return {
            "is_matched": False,
            "count": 0,
            "matched_games": [],
            "description": "Unique position. No direct classical Grandmaster database match found.",
        }

# Re-exports review-match PDF helper
from review import PDFReport, REPORTLAB_AVAILABLE

# Section analysis/simulation

# Simulates future game continuation with analysis
class FutureSimulator:

    PIECE_NAMES = {
        chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop",
        chess.ROOK: "rook", chess.QUEEN: "queen", chess.KING: "king",
    }

    PIECE_VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}

    # Calculates win chance from centipawn score
    @staticmethod
    def calculate_win_chance(score_cp):
        try:
            win_prob = 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-0.00368208 * score_cp)) - 1.0)
            return round(max(0.1, min(99.9, win_prob)), 1)
        except Exception:
            try:
                prob = 1.0 / (1.0 + math.pow(10.0, -score_cp / 400.0)) * 100.0
                return round(max(0.1, min(99.9, prob)), 1)
            except Exception:
                return 50.0

    # Simulates next moves from position via engine
    @classmethod
    async def simulate(cls, stockfish, fen, move_str=None, n_moves=5, depth=12, user_color="white"):
        try:
            board = chess.Board(fen)
        except Exception as e:
            return {"error": f"Invalid FEN: {e}"}

        user_is_white = (str(user_color).strip().lower() != "black")
        user_color_str = "White" if user_is_white else "Black"

        start_fen = board.fen()
        initial_material = cls._get_material_count(board)
        steps: List[Dict[str, Any]] = []
        step_index = 0

        if move_str and move_str.strip():
            initial_move = cls._parse_move(board, move_str.strip())
            if initial_move and initial_move in board.legal_moves:
                from_sq = chess.square_name(initial_move.from_square)
                to_sq = chess.square_name(initial_move.to_square)
                san = board.san(initial_move)
                uci = initial_move.uci()
                moving_side = "White" if board.turn == chess.WHITE else "Black"
                is_user_step = (moving_side == user_color_str)
                player_role = "You" if is_user_step else "Bot"
                piece = board.piece_at(initial_move.from_square)
                piece_name = cls.PIECE_NAMES.get(piece.piece_type, "piece") if piece else "piece"
                is_capture = board.is_capture(initial_move)
                captured_piece = board.piece_at(initial_move.to_square)
                captured_name = cls.PIECE_NAMES.get(captured_piece.piece_type, "") if captured_piece else ""

                fen_before = board.fen()
                board.push(initial_move)
                fen_after = board.fen()

                eval_data = await cls._evaluate_board(stockfish, board, depth=depth)
                score_w = eval_data["score_white"]
                user_score = round(score_w if user_is_white else -score_w, 2)
                win_w = eval_data["win_chance_white"]
                user_win_chance = round(win_w if user_is_white else (100.0 - win_w), 1)

                if eval_data["is_mate"]:
                    white_has_mate = (score_w > 0)
                    user_has_mate = white_has_mate if user_is_white else (not white_has_mate)
                    m_in = abs(eval_data.get("mate_in", 1)) if eval_data.get("mate_in") else 1
                    user_score_display = f"+M{m_in}" if user_has_mate else f"-M{m_in}"
                else:
                    user_score_display = f"+{user_score:.2f}" if user_score > 0 else f"{user_score:.2f}"

                note = cls._generate_step_note(moving_side, player_role, piece_name, san, from_sq, to_sq,
                                                is_capture, captured_name, board.is_check(), board.is_checkmate(), True)

                steps.append({
                    "step_index": 0, "is_initial_move": True, "side": moving_side,
                    "player_role": player_role, "is_user_step": is_user_step,
                    "move_san": san, "move_uci": uci, "from_sq": from_sq, "to_sq": to_sq,
                    "fen_before": fen_before, "fen_after": fen_after,
                    "score_white": eval_data["score_white"], "score_pov": eval_data["score_pov"],
                    "user_score": user_score, "user_score_display": user_score_display,
                    "user_win_chance": user_win_chance, "is_mate": eval_data["is_mate"],
                    "mate_in": eval_data["mate_in"], "score_display": user_score_display,
                    "win_chance_white": eval_data["win_chance_white"], "is_check": board.is_check(),
                    "is_capture": is_capture, "piece_moved": piece_name, "captured_piece": captured_name,
                    "explanation": note,
                    "arrows": [{"from": from_sq, "to": to_sq, "color": "#3b82f6"}],
                })
                step_index = 1

        max_plies = max(2, min(n_moves * 2, 40))
        for _ in range(max_plies):
            if board.is_game_over():
                break

            current_turn = board.turn
            moving_side = "White" if current_turn == chess.WHITE else "Black"
            is_user_step = (moving_side == user_color_str)
            player_role = "You" if is_user_step else "Bot"
            fen_before = board.fen()

            best_move, eval_data = await cls._step_analysis(stockfish, board, depth=depth)
            if not best_move or best_move not in board.legal_moves:
                break

            from_sq = chess.square_name(best_move.from_square)
            to_sq = chess.square_name(best_move.to_square)
            san = board.san(best_move)
            uci = best_move.uci()
            piece = board.piece_at(best_move.from_square)
            piece_name = cls.PIECE_NAMES.get(piece.piece_type, "piece") if piece else "piece"
            is_capture = board.is_capture(best_move)
            captured_piece = board.piece_at(best_move.to_square)
            captured_name = cls.PIECE_NAMES.get(captured_piece.piece_type, "") if captured_piece else ""

            board.push(best_move)
            fen_after = board.fen()

            score_w = eval_data["score_white"]
            user_score = round(score_w if user_is_white else -score_w, 2)
            win_w = eval_data["win_chance_white"]
            user_win_chance = round(win_w if user_is_white else (100.0 - win_w), 1)

            if eval_data["is_mate"]:
                white_has_mate = (score_w > 0)
                user_has_mate = white_has_mate if user_is_white else (not white_has_mate)
                m_in = abs(eval_data.get("mate_in", 1)) if eval_data.get("mate_in") else 1
                user_score_display = f"+M{m_in}" if user_has_mate else f"-M{m_in}"
            else:
                user_score_display = f"+{user_score:.2f}" if user_score > 0 else f"{user_score:.2f}"

            note = cls._generate_step_note(moving_side, player_role, piece_name, san, from_sq, to_sq,
                                            is_capture, captured_name, board.is_check(), board.is_checkmate(), False)
            arrow_color = "#10b981" if is_user_step else "#f59e0b"

            steps.append({
                "step_index": step_index, "is_initial_move": False, "side": moving_side,
                "player_role": player_role, "is_user_step": is_user_step,
                "move_san": san, "move_uci": uci, "from_sq": from_sq, "to_sq": to_sq,
                "fen_before": fen_before, "fen_after": fen_after,
                "score_white": eval_data["score_white"], "score_pov": eval_data["score_pov"],
                "user_score": user_score, "user_score_display": user_score_display,
                "user_win_chance": user_win_chance, "is_mate": eval_data["is_mate"],
                "mate_in": eval_data["mate_in"], "score_display": user_score_display,
                "win_chance_white": eval_data["win_chance_white"], "is_check": board.is_check(),
                "is_capture": is_capture, "piece_moved": piece_name, "captured_piece": captured_name,
                "explanation": note,
                "arrows": [{"from": from_sq, "to": to_sq, "color": arrow_color}],
            })
            step_index += 1

        final_material = cls._get_material_count(board)
        future_impact = cls._synthesize_future_impact(
            initial_board=chess.Board(start_fen), final_board=board,
            initial_material=initial_material, final_material=final_material,
            steps=steps, n_moves=n_moves, user_color=user_color_str,
        )

        return {
            "start_fen": start_fen, "final_fen": board.fen(),
            "total_steps": len(steps), "simulated_moves_count": len(steps) // 2,
            "user_color": user_color_str, "steps": steps, "future_impact": future_impact,
        }

    # Parses move string into board move
    @classmethod
    def _parse_move(cls, board, move_str):
        try:
            mv = chess.Move.from_uci(move_str)
            if mv in board.legal_moves:
                return mv
        except Exception:
            pass
        try:
            mv = board.parse_san(move_str)
            if mv in board.legal_moves:
                return mv
        except Exception:
            pass
        return None

    # Analyzes single simulation step via engine
    @classmethod
    async def _step_analysis(cls, stockfish, board, depth=12):
        best_move = None
        eval_data = {"score_white": 0.0, "score_pov": 0.0, "is_mate": False,
                     "mate_in": None, "score_display": "+0.00", "win_chance_white": 50.0}
        try:
            from engines import EngineType, get_pool
            pool = get_pool(EngineType.STOCKFISH)
            engine = await pool.acquire()
            try:
                info = await engine.analyse(board, chess.engine.Limit(depth=depth, time=0.25))
                import chess.engine
                pv = info.get("pv", [])
                if pv:
                    best_move = pv[0]
                score_obj = info.get("score")
                if score_obj:
                    score_white = score_obj.white().score(mate_score=10000) / 100.0
                    score_pov = score_obj.pov(board.turn).score(mate_score=10000) / 100.0
                    is_mate = score_obj.is_mate()
                    mate_in = score_obj.pov(board.turn).mate() if is_mate else None
                    score_display = f"M{mate_in:+d}" if is_mate and mate_in is not None else f"{score_white:+.2f}"
                    win_chance = cls.calculate_win_chance(score_white * 100.0)
                    eval_data = {
                        "score_white": round(score_white, 2), "score_pov": round(score_pov, 2),
                        "is_mate": is_mate, "mate_in": mate_in,
                        "score_display": score_display, "win_chance_white": win_chance,
                    }
            finally:
                await pool.release(engine)
        except Exception:
            pass

        if not best_move:
            legal = list(board.legal_moves)
            best_move = legal[0] if legal else None
        return best_move, eval_data

    # Evaluates board via engine proxy
    @classmethod
    async def _evaluate_board(cls, stockfish, board, depth=12):
        try:
            from engines import EngineType, get_pool
            import chess.engine
            pool = get_pool(EngineType.STOCKFISH)
            engine = await pool.acquire()
            try:
                info = await engine.analyse(board, chess.engine.Limit(depth=depth, time=0.25))
                score_obj = info.get("score")
                if score_obj:
                    score_white = score_obj.white().score(mate_score=10000) / 100.0
                    score_pov = score_obj.pov(board.turn).score(mate_score=10000) / 100.0
                    is_mate = score_obj.is_mate()
                    mate_in = score_obj.pov(board.turn).mate() if is_mate else None
                    score_display = f"M{mate_in:+d}" if is_mate and mate_in is not None else f"{score_white:+.2f}"
                    win_chance = cls.calculate_win_chance(score_white * 100.0)
                    return {
                        "score_white": round(score_white, 2), "score_pov": round(score_pov, 2),
                        "is_mate": is_mate, "mate_in": mate_in,
                        "score_display": score_display, "win_chance_white": win_chance,
                    }
            finally:
                await pool.release(engine)
        except Exception:
            pass
        return {"score_white": 0.0, "score_pov": 0.0, "is_mate": False,
                "mate_in": None, "score_display": "+0.00", "win_chance_white": 50.0}

    # Counts material on board
    @classmethod
    def _get_material_count(cls, board):
        w_points = 0
        b_points = 0
        w_pieces = {}
        b_pieces = {}
        for pt in [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN]:
            w_count = len(board.pieces(pt, chess.WHITE))
            b_count = len(board.pieces(pt, chess.BLACK))
            name = cls.PIECE_NAMES[pt]
            w_pieces[name] = w_count
            b_pieces[name] = b_count
            w_points += w_count * cls.PIECE_VALUES[pt]
            b_points += b_count * cls.PIECE_VALUES[pt]
        return {"white_points": w_points, "black_points": b_points,
                "diff_white": w_points - b_points, "white_pieces": w_pieces, "black_pieces": b_pieces}

    # Generates narrative note for simulation step
    @classmethod
    def _generate_step_note(cls, moving_side, player_role, piece_name, san, from_sq, to_sq,
                            is_capture, captured_name, is_check, is_mate, is_initial):
        if player_role == "You":
            if is_mate:
                return f"Checkmate! Your {san} ends the game."
            if is_check:
                if is_capture:
                    return f"You take the {captured_name} on {to_sq} with {san} — and give check."
                return f"You give check with {san}, putting their king in immediate danger."
            if is_capture:
                return f"You take their {captured_name} on {to_sq} with {san}."
            if san in ["O-O", "O-O-O"]:
                return f"You castle ({san}): your king gets safe and your rook joins the game."
            if piece_name == "pawn" and to_sq in ["d4", "e4", "d5", "e5"]:
                return f"You push your pawn to {to_sq} ({san}) and take space in the center."
            if piece_name in ["knight", "bishop"]:
                return f"You bring your {piece_name} to {to_sq} ({san}), getting a new piece into the game."
            return f"You move your {piece_name} ({san}) to a better square."
        else:
            if is_mate:
                return f"The bot checkmates you on {to_sq} with {san}."
            if is_check:
                if is_capture:
                    return f"The bot takes your {captured_name} on {to_sq} with {san} — and gives check."
                return f"The bot gives check with {san} — your king must get out of danger."
            if is_capture:
                return f"The bot takes your {captured_name} on {to_sq} ({san})."
            if san in ["O-O", "O-O-O"]:
                return f"The bot castles ({san}) and tucks its king away."
            if piece_name == "pawn" and to_sq in ["d4", "e4", "d5", "e5"]:
                return f"The bot pushes its pawn to {to_sq} ({san}), fighting for the center."
            if piece_name in ["knight", "bishop"]:
                return f"The bot develops its {piece_name} to {to_sq} ({san})."
            return f"The bot moves ({san}) to improve its pieces."

    # Counts passed pawns for color
    @classmethod
    def _count_passed_pawns(cls, board, color):
        passed = 0
        pawns = board.pieces(chess.PAWN, color)
        enemy_pawns = board.pieces(chess.PAWN, not color)
        for sq in pawns:
            file_idx = chess.square_file(sq)
            rank_idx = chess.square_rank(sq)
            files_to_check = [f for f in [file_idx - 1, file_idx, file_idx + 1] if 0 <= f <= 7]
            is_passed = True
            for enemy_sq in enemy_pawns:
                e_file = chess.square_file(enemy_sq)
                e_rank = chess.square_rank(enemy_sq)
                if e_file in files_to_check:
                    if color == chess.WHITE and e_rank > rank_idx:
                        is_passed = False
                        break
                    elif color == chess.BLACK and e_rank < rank_idx:
                        is_passed = False
                        break
            if is_passed:
                passed += 1
        return passed

    # Synthesizes future impact from board change
    @classmethod
    def _synthesize_future_impact(cls, initial_board, final_board, initial_material, final_material,
                                  steps, n_moves, user_color="White"):
        user_is_white = (str(user_color).strip().lower() != "black")
        w_start = initial_material["white_points"]
        w_end = final_material["white_points"]
        b_start = initial_material["black_points"]
        b_end = final_material["black_points"]
        w_lost = w_start - w_end
        b_lost = b_start - b_end
        net_swing_white = (w_end - b_end) - (w_start - b_start)
        net_swing_user = net_swing_white if user_is_white else -net_swing_white

        if net_swing_user > 0:
            material_verdict = f"You win +{net_swing_user} points of material over the {len(steps)} simulated steps."
        elif net_swing_user < 0:
            material_verdict = f"The Bot gains +{abs(net_swing_user)} points of material advantage over the sequence."
        else:
            lost_user = w_lost if user_is_white else b_lost
            if lost_user > 0:
                material_verdict = f"Equal piece trade: both you and the bot exchange {lost_user} material points."
            else:
                material_verdict = "No material captures occur; the position evolves along strategic lines."

        evals_user = [s.get("user_score", s.get("score_white", 0.0) if user_is_white else -s.get("score_white", 0.0)) for s in steps]
        start_score = evals_user[0] if evals_user else 0.0
        final_score = evals_user[-1] if evals_user else 0.0
        score_diff = round(final_score - start_score, 2)

        tactical_highlights = []
        checks_count = sum(1 for s in steps if s.get("is_check"))
        captures_count = sum(1 for s in steps if s.get("is_capture"))
        if checks_count > 0:
            tactical_highlights.append(f"{checks_count} forcing check(s) were delivered during the line.")
        if captures_count > 0:
            tactical_highlights.append(f"{captures_count} tactical capture(s) resolved piece tension.")

        w_castled = any(s.get("side") == "White" and s.get("move_san") in ["O-O", "O-O-O"] for s in steps)
        b_castled = any(s.get("side") == "Black" and s.get("move_san") in ["O-O", "O-O-O"] for s in steps)
        user_castled = w_castled if user_is_white else b_castled
        bot_castled = b_castled if user_is_white else w_castled

        initial_w_queens = len(initial_board.pieces(chess.QUEEN, chess.WHITE))
        final_w_queens = len(final_board.pieces(chess.QUEEN, chess.WHITE))
        final_b_queens = len(final_board.pieces(chess.QUEEN, chess.BLACK))
        queens_traded = (initial_w_queens > 0 and final_w_queens == 0)

        w_passed = cls._count_passed_pawns(final_board, chess.WHITE)
        b_passed = cls._count_passed_pawns(final_board, chess.BLACK)
        user_passed = w_passed if user_is_white else b_passed
        bot_passed = b_passed if user_is_white else w_passed
        if user_passed > 0:
            tactical_highlights.append(f"You establish {user_passed} dangerous passed pawn(s).")
        if bot_passed > 0:
            tactical_highlights.append(f"The Bot commands {bot_passed} active passed pawn(s).")

        n_actual_moves = (len(steps) + 1) // 2
        if final_board.is_checkmate():
            user_turn = (final_board.turn == (chess.WHITE if user_is_white else chess.BLACK))
            if not user_turn:
                benefit_verdict = f"Highly Beneficial: You force an unavoidable Checkmate in {len(steps)} plies!"
                benefit_type = "beneficial"
            else:
                benefit_verdict = f"Detrimental: Allows the Bot an unavoidable Checkmate in {len(steps)} plies!"
                benefit_type = "unfavorable"
        elif score_diff >= 0.30:
            if final_score <= -1.50:
                benefit_verdict = f"Resilient Defense: Improves your position by +{score_diff:.2f} cp despite a difficult eval ({final_score:+.2f})."
                benefit_type = "beneficial"
            elif final_score >= 1.50:
                benefit_verdict = f"Beneficial for You: Consolidates a winning advantage ({final_score:+.2f} eval, +{score_diff:.2f} cp gain)."
                benefit_type = "beneficial"
            else:
                benefit_verdict = f"Beneficial for You: Improves your position by +{score_diff:.2f} cp ({final_score:+.2f} eval)."
                benefit_type = "beneficial"
        elif score_diff <= -0.30:
            benefit_verdict = f"Unfavorable for You: Weakens your position by {abs(score_diff):.2f} cp ({final_score:+.2f} eval)."
            benefit_type = "unfavorable"
        else:
            if final_score >= 1.50:
                benefit_verdict = f"Favorable & Controlled: Maintains your commanding advantage ({final_score:+.2f} eval, {score_diff:+.2f} cp)."
                benefit_type = "beneficial"
            elif final_score <= -1.50:
                benefit_verdict = f"Challenging Position: Holds the line ({score_diff:+.2f} cp) but remains under heavy pressure ({final_score:+.2f} eval)."
                benefit_type = "unfavorable"
            else:
                benefit_verdict = f"Neutral / Balanced: Maintains strategic equilibrium with equal dynamic play ({final_score:+.2f} eval)."
                benefit_type = "neutral"

        overall_analysis_points = []
        if score_diff > 0.30:
            overall_analysis_points.append(
                f"**Evaluation Trajectory:** Steadily improves from **{start_score:+.2f}** to **{final_score:+.2f}** (+{score_diff:.2f} cp swing)."
            )
        elif score_diff < -0.30:
            overall_analysis_points.append(
                f"**Evaluation Trajectory:** Slips from **{start_score:+.2f}** to **{final_score:+.2f}** ({score_diff:+.2f} cp swing)."
            )
        else:
            overall_analysis_points.append(
                f"**Evaluation Trajectory:** Holds steady ({start_score:+.2f} -> {final_score:+.2f})."
            )

        if net_swing_user > 0:
            overall_analysis_points.append(
                f"**Tactical Exchanges:** You come out ahead by +{net_swing_user} material points across {captures_count} capture(s)."
            )
        elif net_swing_user < 0:
            overall_analysis_points.append(
                f"**Tactical Exchanges:** The Bot wins +{abs(net_swing_user)} material points through tactical conversions."
            )
        elif captures_count > 0:
            overall_analysis_points.append(f"**Tactical Exchanges:** Balanced trades ({captures_count} capture(s)).")
        else:
            overall_analysis_points.append("**Positional Maneuvers:** No captures; pieces maneuver into strategic outposts.")

        if user_castled and bot_castled:
            overall_analysis_points.append("**King Safety:** Both sides castle, securing King safety.")
        elif user_castled:
            overall_analysis_points.append("**King Safety:** You castle, establishing king security.")
        elif bot_castled:
            overall_analysis_points.append("**King Safety:** The Bot castles to secure its King.")

        if queens_traded:
            overall_analysis_points.append("**Phase Transition:** Queens traded, steering into a technical endgame.")

        if benefit_type == "beneficial":
            if start_score <= -1.50:
                rec_note = f"**GM Recommendation:** Resourceful defense. This {n_actual_moves}-move continuation fights back (+{score_diff:.2f} cp)."
            else:
                rec_note = f"**GM Recommendation:** Beneficial to enter. Yields tangible advantages for you."
        elif benefit_type == "unfavorable":
            rec_note = f"**GM Recommendation:** Caution advised. This line degrades your position by {abs(score_diff):.2f} cp."
        else:
            rec_note = f"**GM Recommendation:** Playable & Solid. A safe, equal continuation."
        overall_analysis_points.append(rec_note)

        storyline = ""
        if final_board.is_checkmate():
            user_won = (final_board.turn != (chess.WHITE if user_is_white else chess.BLACK))
            winner_str = "You" if user_won else "Bot"
            storyline = f"Decisive Sequence: Culminates in checkmate for {winner_str} in {len(steps)} plies!"
        elif abs(final_score) >= 3.0:
            favored_str = "You" if final_score > 0 else "Bot"
            storyline = f"Winning Conversion: Leads to a winning endgame for {favored_str} ({final_score:+.2f} eval)."

        final_position_eval = None
        favourable_to = "user" if benefit_type == "beneficial" else ("bot" if benefit_type == "unfavorable" else "neutral")
        why_reasons: list[str] = []
        try:
            from intelligence import PositionalEvaluator as _PE
            final_position_eval = _PE.evaluate(final_board.fen())
            params = (final_position_eval or {}).get("parameters", {})
            user_sign = 1 if user_is_white else -1
            ranked = sorted(
                params.items(),
                key=lambda kv: abs(float((kv[1] or {}).get("diff", 0)) * user_sign),
                reverse=True,
            )
            for key, p in ranked[:3]:
                try:
                    d = float(p.get("diff", 0)) * user_sign
                    if abs(d) < 15:
                        continue
                    name = p.get("name", key)
                    side = "you" if d > 0 else "the bot"
                    why_reasons.append(f"{name}: {side} lead by {abs(int(d))} cp in the final position.")
                except Exception:
                    continue
            if net_swing_user > 0:
                why_reasons.append(f"You are up +{net_swing_user} material points across the line.")
            elif net_swing_user < 0:
                why_reasons.append(f"The bot is up +{abs(net_swing_user)} material points across the line.")
            if user_passed > 0 and bot_passed == 0:
                why_reasons.append(f"Your {user_passed} passed pawn(s) are the decisive long-term asset.")
            elif bot_passed > 0 and user_passed == 0:
                why_reasons.append(f"The bot's {bot_passed} passed pawn(s) decide the endgame.")
            if final_board.is_checkmate():
                winner_is_user = (final_board.turn != (chess.WHITE if user_is_white else chess.BLACK))
                why_reasons.append("The line ends in checkmate." if winner_is_user else "The line allows checkmate against you.")
            if not why_reasons:
                why_reasons.append(" Engines see no decisive structural edge; the edge is purely the eval trajectory above.")
        except Exception:
            pass

        return {
            "summary": storyline, "benefit_verdict": benefit_verdict, "benefit_type": benefit_type,
            "overall_analysis_points": overall_analysis_points, "material_verdict": material_verdict,
            "start_eval": start_score, "final_eval": final_score, "eval_shift": score_diff,
            "start_material": {"white": w_start, "black": b_start},
            "final_material": {"white": w_end, "black": b_end},
            "net_swing_white": net_swing_white, "net_swing_user": net_swing_user,
            "checks_count": checks_count, "captures_count": captures_count,
            "tactical_highlights": tactical_highlights,
            "white_passed_pawns": w_passed, "black_passed_pawns": b_passed,
            "user_passed_pawns": user_passed, "bot_passed_pawns": bot_passed,
            "final_fen": final_board.fen(),
            "final_position_eval": final_position_eval,
            "favourable_to": favourable_to,
            "favourable_label": {"user": "Favourable to you", "bot": "Favourable to the bot", "neutral": "Neutral"}[favourable_to],
            "why": why_reasons,
        }

# Re-exports review-match game analyzer
from review import GameAnalyzer
