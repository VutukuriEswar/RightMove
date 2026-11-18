# Generates real-time AI move comparisons and session debriefs for personalized curriculum
import logging
import re
import chess
from llm_client import generate_text_cascade
from curriculum.heuristics import get_coaching_heuristics

logger = logging.getLogger(__name__)


# Generates specific tactical reason comparing engine best move with player's move
async def generate_move_comparison(
    fen: str,
    best_move: str,
    move_played: str,
    cluster_name: str = "Tactical Awareness",
    player_elo: int = 1200
) -> dict:
    side = "White"
    piece_played = "piece"
    piece_best = "piece"
    is_capture_best = False
    is_check_best = False

    try:
        board = chess.Board(fen)
        side = "White" if board.turn == chess.WHITE else "Black"

        # Check move played
        try:
            m_played = board.parse_san(move_played)
        except Exception:
            try:
                m_played = chess.Move.from_uci(move_played)
            except Exception:
                m_played = None

        if m_played:
            p = board.piece_at(m_played.from_square)
            if p:
                piece_played = chess.piece_name(p.piece_type)

        # Check best move
        try:
            m_best = board.parse_san(best_move)
        except Exception:
            try:
                m_best = chess.Move.from_uci(best_move)
            except Exception:
                m_best = None

        if m_best:
            p = board.piece_at(m_best.from_square)
            if p:
                piece_best = chess.piece_name(p.piece_type)
            is_capture_best = board.is_capture(m_best)
            board.push(m_best)
            is_check_best = board.is_check()
            board.pop()
    except Exception as e:
        logger.debug(f"[coach_ai] Error inspecting FEN with chess.Board: {e}")

    # Fallback default values
    why_best_fallback = (
        f"{best_move} is the decisive engine choice because it actively coordinates the {piece_best}, "
        f"{'delivering check and seizing tempo' if is_check_best else 'claiming central control and creating immediate threats'}."
    )
    why_failed_fallback = (
        f"{move_played} is suboptimal because moving the {piece_played} here cedes the initiative, "
        f"allowing the opponent to organize counterplay instead of facing concrete pressure."
    )
    takeaway_fallback = f"In {cluster_name.lower()} positions, prioritize active piece threats over passive defensive retreats."

    system_prompt = (
        "You are an elite Grandmaster chess coach. Provide concise, punchy, high-impact tactical analysis "
        "comparing a player's move against the engine's best move. Do not waffle. Be direct and instructive."
    )
    user_prompt = f"""Position FEN: {fen}
Side to move: {side}
Weakness Category: {cluster_name}
Player Elo: {player_elo}

Player move played: {move_played}
Engine best move: {best_move}

Respond in exactly this format with these three tags:
[WHY_BEST]: (1-2 sentences on why {best_move} is objectively best)
[WHY_PLAYED_FAILED]: (1-2 sentences on why {move_played} is a mistake or inferior)
[TAKEAWAY]: (1 sentence memorable rule of thumb)"""

    try:
        raw_text, source = await generate_text_cascade(system_prompt, user_prompt, timeout=12.0)
        if raw_text:
            why_best_match = re.search(r"\[WHY_BEST\]:?\s*(.*?)(?=\[WHY_PLAYED_FAILED\]|\n\n|$)", raw_text, re.DOTALL | re.IGNORECASE)
            why_failed_match = re.search(r"\[WHY_PLAYED_FAILED\]:?\s*(.*?)(?=\[TAKEAWAY\]|\n\n|$)", raw_text, re.DOTALL | re.IGNORECASE)
            takeaway_match = re.search(r"\[TAKEAWAY\]:?\s*(.*?)$", raw_text, re.DOTALL | re.IGNORECASE)

            why_best = why_best_match.group(1).strip() if why_best_match else ""
            why_failed = why_failed_match.group(1).strip() if why_failed_match else ""
            takeaway = takeaway_match.group(1).strip() if takeaway_match else ""

            if why_best and why_failed:
                return {
                    "why_best": why_best,
                    "why_played_failed": why_failed,
                    "takeaway": takeaway or takeaway_fallback,
                    "source": source
                }
    except Exception as e:
        logger.info(f"[coach_ai] LLM cascade comparison failed, using rule-based fallback: {e}")

    return {
        "why_best": why_best_fallback,
        "why_played_failed": why_failed_fallback,
        "takeaway": takeaway_fallback,
        "source": "rule-based"
    }


# Generates playing-style debrief, root-cause diagnosis, and action plan after a drill session
async def generate_session_debrief(
    cluster_id: str,
    cluster_name: str,
    total_attempted: int,
    total_correct: int,
    positions: list[dict],
    player_elo: int = 1200,
    cluster_stage: str = "Active"
) -> dict:
    heuristics = get_coaching_heuristics(cluster_id, cluster_name)
    concept = heuristics.get("concept", f"Recurring inaccuracies in {cluster_name}")
    root_cause = heuristics.get("root_cause", "Impulsive candidate move selection without calculating opponent forcing replies.")
    guidance = heuristics.get("guidance", "Focus on deliberate calculation of checks, captures, and threats before finalizing candidate moves.")

    accuracy_pct = round((total_correct / max(1, total_attempted)) * 100)

    # Format mistake summary from positions
    mistakes = [p for p in positions if not p.get("is_correct")]
    mistake_lines = []
    for idx, m in enumerate(mistakes[:4], 1):
        mistake_lines.append(
            f"- Position {idx}: Played {m.get('move_played', 'unknown')} instead of best move {m.get('best_move', 'best')}."
        )
    mistakes_text = "\n".join(mistake_lines) if mistake_lines else "None! Clean session performance."

    # Fallbacks
    style_diagnosis_fallback = (
        f"Based on your in-game habits, your playing style suffers from {root_cause.lower()} "
        f"When tension rises in {cluster_name.lower()}, you tend to pick the first comfortable move "
        f"rather than actively verifying whether your piece coordinates aggressively."
    )
    what_to_do_fallback = (
        f"Before committing your move in these positions, ask: 'Does my move actively create a concrete threat, "
        f"or am I just defending out of fear?' Always search for candidate moves that seize the open line or pin enemy pieces."
    )
    action_plan_fallback = (
        f"1. Spend 15 seconds scanning all opponent checks and captures before moving.\n"
        f"2. Practice {cluster_name} puzzles with emphasis on aggressive counter-strikes.\n"
        f"3. Review your games immediately after playing to tag instances where you played passively."
    )
    coach_takeaway_fallback = (
        f"Mastery in {cluster_name} requires treating your pieces as active attackers rather than passive defenders."
    )

    system_prompt = (
        "You are a master chess psychologist and Grandmaster coach. Analyze a player's drill performance "
        "to diagnose their underlying psychological/playing-style habits and give a high-impact improvement plan."
    )
    user_prompt = f"""Weakness Profile: {cluster_name} ({concept})
Player Elo: {player_elo}
Current Stage: {cluster_stage}
Session Score: {total_correct} / {total_attempted} ({accuracy_pct}%)

Mistakes made in this drill session:
{mistakes_text}

Provide an actionable debrief structured with these tags:
[STYLE_DIAGNOSIS]: (2-3 sentences diagnosing WHY their playing style and thinking habit causes this specific recurring mistake over the board)
[WHAT_TO_DO_INSTEAD]: (2 sentences on the exact mental instinct and move-selection trigger they must adopt instead)
[ACTION_PLAN]: (Exactly 3 numbered steps with specific deliberate practice exercises to eliminate this habit)
[COACH_TAKEAWAY]: (1 punchy inspirational Grandmaster motto)"""

    try:
        raw_text, source = await generate_text_cascade(system_prompt, user_prompt, timeout=16.0)
        if raw_text:
            diag_match = re.search(r"\[STYLE_DIAGNOSIS\]:?\s*(.*?)(?=\[WHAT_TO_DO_INSTEAD\]|\n\n|$)", raw_text, re.DOTALL | re.IGNORECASE)
            instead_match = re.search(r"\[WHAT_TO_DO_INSTEAD\]:?\s*(.*?)(?=\[ACTION_PLAN\]|\n\n|$)", raw_text, re.DOTALL | re.IGNORECASE)
            plan_match = re.search(r"\[ACTION_PLAN\]:?\s*(.*?)(?=\[COACH_TAKEAWAY\]|\n\n|$)", raw_text, re.DOTALL | re.IGNORECASE)
            takeaway_match = re.search(r"\[COACH_TAKEAWAY\]:?\s*(.*?)$", raw_text, re.DOTALL | re.IGNORECASE)

            diag = diag_match.group(1).strip() if diag_match else ""
            instead = instead_match.group(1).strip() if instead_match else ""
            plan = plan_match.group(1).strip() if plan_match else ""
            takeaway = takeaway_match.group(1).strip() if takeaway_match else ""

            if diag and instead:
                return {
                    "style_diagnosis": diag,
                    "what_to_do_instead": instead,
                    "action_plan_to_overcome": plan or action_plan_fallback,
                    "coach_takeaway": takeaway or coach_takeaway_fallback,
                    "source": source
                }
    except Exception as e:
        logger.info(f"[coach_ai] Debrief LLM cascade failed, using heuristics fallback: {e}")

    return {
        "style_diagnosis": style_diagnosis_fallback,
        "what_to_do_instead": what_to_do_fallback,
        "action_plan_to_overcome": action_plan_fallback,
        "coach_takeaway": coach_takeaway_fallback,
        "source": "heuristics"
    }
