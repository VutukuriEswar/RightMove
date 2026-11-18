# Manages triggers for mistake logging, clustering, and agent reports
import asyncio
from datetime import datetime, timezone
import chess
from core import get_db
from curriculum.features import extract_features
from curriculum.clustering import run_clustering


# Determines game phase string from total pieces remaining on board
def determine_game_phase(board: chess.Board) -> str:
    total_pieces = len(board.piece_map())
    if total_pieces >= 28:
        return "opening"
    if total_pieces >= 14:
        return "middlegame"
    return "endgame"


# Ingests analyzed game mistakes and triggers clustering when threshold met
async def post_analysis_hook(user_id: str, game_id: str, mistakes: list, player_color: str = "white") -> int:
    db = get_db()
    now = datetime.now(timezone.utc)
    logged = 0

    for m in mistakes:
        cp_loss = int(float(m.get("cp_loss") or m.get("centipawn_loss") or 0))
        if cp_loss < 100:
            continue

        fen = m.get("fen_before")
        if not fen:
            continue

        try:
            b = chess.Board(fen)
            feat_vec = extract_features(b).tolist()
            phase = determine_game_phase(b)
        except Exception:
            feat_vec = [0.0] * 32
            phase = "middlegame"

        move_num = int(m.get("fullmove_number") or m.get("move_number") or 1)
        move_played = str(m.get("san") or m.get("move") or "")
        best_move = str(m.get("best_move_san") or m.get("best_move") or "")
        m_color = str(m.get("turn") or player_color).lower()
        if m_color not in ("white", "black"):
            m_color = "white"

        doc = {
            "user_id": user_id,
            "game_id": game_id,
            "game_date": m.get("game_date") or now,
            "move_number": move_num,
            "player_color": m_color,
            "fen_before": fen,
            "move_played": move_played,
            "best_move": best_move,
            "centipawn_loss": cp_loss,
            "is_blunder": cp_loss >= 300,
            "feature_vector": feat_vec,
            "cluster_id": None,
            "phase": phase,
            "clustered_at": None,
            "created_at": now,
        }

        await db.mistake_positions.insert_one(doc)
        logged += 1

    if logged > 0:
        await db.curriculum_state.update_one(
            {"user_id": user_id},
            {
                "$inc": {
                    "total_mistakes_logged": logged,
                    "games_since_last_cluster": 1,
                },
                "$set": {"updated_at": now},
            },
            upsert=True,
        )

        unclustered_count = await db.mistake_positions.count_documents({
            "user_id": user_id,
            "cluster_id": None,
        })
        if unclustered_count >= 15:
            asyncio.create_task(run_clustering(user_id))

    return logged


# Checks whether unclustered mistakes count satisfies clustering threshold
async def check_clustering_threshold(user_id: str) -> bool:
    db = get_db()
    count = await db.mistake_positions.count_documents({
        "user_id": user_id,
        "cluster_id": None,
    })
    return count >= 15


# Evaluates criteria determining whether weakness cluster requires fresh report
def check_agent_trigger(cluster: dict) -> bool:
    now = datetime.now(timezone.utc)
    last_reported = cluster.get("last_reported_at")
    mistake_count = cluster.get("mistake_count", 0)
    since_report = cluster.get("mistake_count_since_report", 0)
    trend = cluster.get("mistake_rate_trend", "stable")

    if mistake_count < 10:
        return False
    if last_reported is None:
        return True
    if trend == "increasing":
        return True
    if last_reported and last_reported.tzinfo is None:
        last_reported = last_reported.replace(tzinfo=timezone.utc)
    days = (now - last_reported).days
    return days >= 14 and since_report >= 5
