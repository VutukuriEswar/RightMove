# Generates multi-step AI coaching reports and seeds spaced repetition drills
import asyncio
from datetime import datetime, timezone
import re
from bson import ObjectId
import numpy as np
import chess
from core import get_db
from curriculum.features import extract_features, position_difficulty

PROMPT_STEP1 = """You are a chess coach analyzing a player's mistake pattern.

Mistake pattern data:
- Position type: {display_name}
- Position characteristics: {feature_summary}
- Number of times this occurred: {mistake_count}
- Improvement trend: {improvement_trend}

Three representative positions where the player made mistakes:
{positions_text}

In ONE precise sentence, name the specific chess concept this player is struggling with.
Be specific — not "endgame play" but "failing to activate the rook to the 7th rank in open rook endgames with equal material."

Respond with only that one sentence."""

PROMPT_STEP2 = """Chess coach analysis.

Identified weakness: {step1_output}
This has occurred {mistake_count} times. Trend: {improvement_trend}.
Player Elo: {player_elo}

Mistake details:
{positions_text}

In 2–3 sentences, diagnose the root cause.
What flawed understanding or thinking pattern causes this to keep happening?
Be specific to chess — not generic advice."""

PROMPT_STEP3 = """Chess coach.

Weakness: {step1_output}
Root cause: {step2_output}

Give exactly 3 questions the player should ask themselves before making this type of move.
Each question must directly counter the identified flawed thinking.
Format as a numbered list. Nothing else."""

PROMPT_STEP4 = """Chess coach.

Weakness: {step1_output}
Player Elo: {player_elo}

In 3–4 sentences, describe the ideal drill progression to fix this weakness:
- What type of positions to start with (simplest manifestation)
- What to progress to (harder variations)
- What mastery looks like (how the player should feel/react when fixed)"""


# Formats representative positions into readable text block for LLM prompts
def format_positions(positions: list[dict]) -> str:
    lines = []
    for i, p in enumerate(positions, 1):
        lines.append(
            f"Position {i}: FEN='{p.get('fen', '')}' | Move played: {p.get('move_played', '')} "
            f"(Centipawn loss: {p.get('centipawn_loss', 0)}) | Engine best: {p.get('best_move', '')}"
        )
    return "\n".join(lines) if lines else "No representative positions recorded."


# Extracts clean question strings from numbered prompt output
def parse_numbered_list(text: str) -> list[str]:
    lines = text.strip().split("\n")
    results = []
    for line in lines:
        cleaned = re.sub(r"^\s*(\d+[\.\)\-:]|\*|\-)\s*", "", line).strip()
        if cleaned:
            results.append(cleaned)
    if len(results) >= 3:
        return results[:3]
    return [
        "Is there an open file, rank, or diagonal I can invade or control?",
        "Can I place this piece where it actively restricts the opponent?",
        "Am I moving to attack a real target, or just to feel safe?",
    ]


# Executes Qwen inference via local pipeline with fallback logic
async def qwen_generate(prompt: str, fallback: str) -> str:
    try:
        from intelligence import _hf_local_text
        loop = asyncio.get_running_loop()
        res = await loop.run_in_executor(None, _hf_local_text, "You are a master chess coach.", prompt)
        if res and res.strip():
            return res.strip()
    except Exception:
        pass
    return fallback


# Builds input payload for AI agent analysis chain
async def build_agent_input(user_id: str, cluster_id: str) -> dict:
    db = get_db()
    cluster = await db.weakness_clusters.find_one({"user_id": user_id, "cluster_id": cluster_id})
    if not cluster:
        raise ValueError(f"Cluster {cluster_id} not found for user {user_id}")

    mistakes = await db.mistake_positions.find(
        {"user_id": user_id, "cluster_id": cluster_id}
    ).sort("created_at", -1).limit(20).to_list(None)

    user = None
    if ObjectId.is_valid(user_id):
        user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        user = await db.users.find_one({"username": user_id})

    prev_report = await db.weakness_reports.find_one(
        {"user_id": user_id, "cluster_id": cluster_id},
        sort=[("generated_at", -1)]
    )

    top3 = mistakes[:3]

    all_m = await db.mistake_positions.find(
        {"user_id": user_id, "cluster_id": cluster_id}
    ).sort("created_at", 1).to_list(None)
    half = len(all_m) // 2
    if half > 0:
        recent_rate = len(all_m[half:]) / max(1, len(set(m.get("game_id", "") for m in all_m[half:])))
        earlier_rate = len(all_m[:half]) / max(1, len(set(m.get("game_id", "") for m in all_m[:half])))
        trend = "improving" if recent_rate < earlier_rate else ("stable" if abs(recent_rate - earlier_rate) < 0.2 else "worsening")
    else:
        trend = "insufficient data"

    return {
        "cluster_label": cluster.get("human_label", "tactical"),
        "display_name": cluster.get("display_name", "Tactical Awareness"),
        "feature_summary": str(cluster.get("feature_summary", {})),
        "mistake_count": cluster.get("mistake_count", len(mistakes)),
        "representative_positions": [
            {
                "fen": m.get("fen_before", ""),
                "move_played": m.get("move_played", ""),
                "best_move": m.get("best_move", ""),
                "centipawn_loss": m.get("centipawn_loss", 0),
                "move_number": m.get("move_number", 1),
            }
            for m in top3
        ],
        "player_elo": int(user.get("elo", 1200)) if user else 1200,
        "improvement_trend": trend,
        "previous_summary": prev_report.get("pattern_name") if prev_report else None,
    }


# Runs 4-step reasoning agent report chain and seeds drill positions
async def run_agent_report(user_id: str, cluster_id: str) -> dict:
    db = get_db()
    pkg = await build_agent_input(user_id, cluster_id)
    pos_text = format_positions(pkg["representative_positions"])
    display_name = pkg["display_name"]

    fallback_step1 = f"Consistent inaccuracy in {display_name.lower()} where passive piece placement forfeits the initiative."
    fallback_step2 = f"The player tends to prioritize immediate safety over active piece coordination, failing to recognize that tactical activity is the best defense in {display_name.lower()}."
    fallback_step3 = (
        "1. Is there an open file, rank, or diagonal I can invade?\n"
        "2. Can I place this piece behind a passed pawn or into an outpost?\n"
        "3. Am I moving to attack, or merely to react passively?"
    )
    fallback_step4 = (
        f"Start with simplified {display_name.lower()} positions focusing on immediate piece activation. "
        "Progress to complex positions with counterplay where tactical accuracy is required. "
        "Mastery is achieved when active moves are identified automatically under time pressure."
    )

    step1 = await qwen_generate(
        PROMPT_STEP1.format(**pkg, positions_text=pos_text),
        fallback=fallback_step1
    )
    step2 = await qwen_generate(
        PROMPT_STEP2.format(**pkg, step1_output=step1, positions_text=pos_text),
        fallback=fallback_step2
    )
    step3 = await qwen_generate(
        PROMPT_STEP3.format(**pkg, step1_output=step1, step2_output=step2),
        fallback=fallback_step3
    )
    step4 = await qwen_generate(
        PROMPT_STEP4.format(**pkg, step1_output=step1),
        fallback=fallback_step4
    )

    signals = parse_numbered_list(step3)
    now = datetime.now(timezone.utc)

    report = {
        "user_id": user_id,
        "cluster_id": cluster_id,
        "generated_at": now,
        "pattern_name": step1.strip(),
        "root_cause": step2.strip(),
        "signals": signals,
        "drill_guidance": step4.strip(),
        "mistake_count_at_generation": pkg["mistake_count"],
        "player_elo_at_generation": pkg["player_elo"],
        "representative_positions": [p["fen"] for p in pkg["representative_positions"]],
        "is_active": True,
        "acknowledged_by_user": False,
        "dismissed_at": None,
    }

    insert_result = await db.weakness_reports.insert_one(report)
    report["_id"] = str(insert_result.inserted_id)

    await db.weakness_clusters.update_one(
        {"user_id": user_id, "cluster_id": cluster_id},
        {"$set": {"last_reported_at": now, "mistake_count_since_report": 0}}
    )

    for pos in pkg["representative_positions"]:
        fen = pos.get("fen")
        if not fen:
            continue
        existing = await db.srs_records.find_one({
            "user_id": user_id,
            "cluster_id": cluster_id,
            "fen": fen,
        })
        if not existing:
            try:
                b = chess.Board(fen)
                feats = extract_features(b)
                diff = position_difficulty(feats)
            except Exception:
                diff = 1.0

            srs_doc = {
                "user_id": user_id,
                "cluster_id": cluster_id,
                "fen": fen,
                "best_move": pos.get("best_move", ""),
                "alternative_moves": [],
                "explanation": signals[0] if signals else "Find the most active move in the position.",
                "easiness_factor": 2.5,
                "interval_days": 1,
                "repetition_count": 0,
                "next_review_at": now,
                "last_reviewed_at": None,
                "quality_history": [],
                "position_difficulty": diff,
                "elo_at_creation": pkg["player_elo"],
                "created_at": now,
            }
            await db.srs_records.insert_one(srs_doc)

    return report
