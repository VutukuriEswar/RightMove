# Implements spaced repetition scheduling and weakness health analytics
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from core import get_db


# Returns current UTC datetime
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Calculates composite weakness health score from drills, maturity, and game data
def compute_health(cluster_id: str, srs_records: list, game_mistakes: list) -> float:
    all_quality = []
    for rec in srs_records:
        all_quality += [h["quality"] for h in rec.get("quality_history", []) if "quality" in h]
    recent_q = all_quality[-10:] if len(all_quality) >= 10 else all_quality
    drill_accuracy = (sum(recent_q) / (5.0 * len(recent_q))) if recent_q else 0.0

    mature = sum(1 for r in srs_records if r.get("interval_days", 1) > 14)
    interval_maturity = (mature / len(srs_records)) if srs_records else 0.0

    def extract_date(m):
        dt = m.get("game_date") or m.get("created_at")
        if isinstance(dt, datetime):
            return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
        return datetime.min.replace(tzinfo=timezone.utc)

    sorted_m = sorted(game_mistakes, key=extract_date)
    half = len(sorted_m) // 2
    if half > 0:
        early_games = len(set(m.get("game_id", "") for m in sorted_m[:half]))
        recent_games = len(set(m.get("game_id", "") for m in sorted_m[half:]))
        early_rate = half / max(1, early_games)
        recent_rate = len(sorted_m[half:]) / max(1, recent_games)
        game_improvement = max(0.0, 1.0 - (recent_rate / max(0.01, early_rate)))
    else:
        game_improvement = 0.0

    health = (drill_accuracy * 0.4) + (interval_maturity * 0.3) + (game_improvement * 0.3)
    return float(round(min(1.0, health) * 100.0))


# Returns stage description corresponding to numerical health level
def stage_from_health(health: float) -> str:
    if health <= 30.0:
        return "Active"
    if health <= 60.0:
        return "Improving"
    if health <= 80.0:
        return "Strong"
    return "Resolved"


# Computes new interval, easiness factor, and repetition count using chess-adapted SM-2
def calculate_sm2_update(quality: int, reps: int, interval: int, ef: float, diff: float, elo_delta: int = 0) -> dict:
    if quality >= 3:
        if reps == 0:
            raw_interval = 1
        elif reps == 1:
            raw_interval = 6
        else:
            raw_interval = round(interval * ef)

        adjusted = max(1, round(raw_interval * (1.0 / max(0.1, diff))))
        ef = max(1.3, ef + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
        reps += 1
    else:
        adjusted = 1
        reps = 0

    if elo_delta >= 50:
        adjusted = max(1, round(adjusted * 0.8))

    return {
        "interval_days": adjusted,
        "easiness_factor": ef,
        "repetition_count": reps,
    }


# Updates SRS record interval, easiness factor, and review schedule
async def update_srs_record(record_id: str, quality: int, time_taken: int, player_elo: int) -> dict:
    db = get_db()
    oid = ObjectId(record_id) if ObjectId.is_valid(record_id) else record_id
    record = await db.srs_records.find_one({"_id": oid})
    if not record:
        raise ValueError(f"SRS record {record_id} not found")

    ef = float(record.get("easiness_factor", 2.5))
    reps = int(record.get("repetition_count", 0))
    interval = int(record.get("interval_days", 1))
    diff = float(record.get("position_difficulty", 1.0))
    elo_delta = player_elo - int(record.get("elo_at_creation", player_elo))
    now = utcnow()

    sm2_res = calculate_sm2_update(quality, reps, interval, ef, diff, elo_delta)
    adjusted = sm2_res["interval_days"]
    new_ef = sm2_res["easiness_factor"]
    new_reps = sm2_res["repetition_count"]

    next_review = now + timedelta(days=adjusted)

    update_doc = {
        "easiness_factor": new_ef,
        "interval_days": adjusted,
        "repetition_count": new_reps,
        "next_review_at": next_review,
        "last_reviewed_at": now,
    }

    history_item = {
        "quality": quality,
        "time_taken": time_taken,
        "date": now,
    }

    await db.srs_records.update_one(
        {"_id": oid},
        {
            "$set": update_doc,
            "$push": {"quality_history": history_item},
        }
    )

    return {
        "record_id": str(record["_id"]),
        "new_interval_days": adjusted,
        "easiness_factor": ef,
        "repetition_count": reps,
        "next_review_at": next_review,
    }


# Retrieves balanced queue of overdue drill positions for training session
async def get_drill_queue(user_id: str, cluster_filter: str | None = None) -> list:
    db = get_db()
    now = utcnow()
    query = {
        "user_id": user_id,
        "next_review_at": {"$lte": now},
    }
    if cluster_filter:
        query["cluster_id"] = cluster_filter

    due = await db.srs_records.find(query).sort("next_review_at", 1).to_list(None)

    per_cluster = defaultdict(list)
    for rec in due:
        per_cluster[rec["cluster_id"]].append(rec)

    queue = []
    for cluster_id, recs in per_cluster.items():
        queue += recs[:3]

    def _drill_sort_key(r):
        dt = r.get("next_review_at")
        if isinstance(dt, datetime):
            return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
        return now

    queue.sort(key=_drill_sort_key)
    selected = queue[:12]

    cluster_ids = list(set(r["cluster_id"] for r in selected))
    clusters = await db.weakness_clusters.find({"user_id": user_id, "cluster_id": {"$in": cluster_ids}}).to_list(None)
    cluster_map = {c["cluster_id"]: c for c in clusters}

    result = []
    for r in selected:
        cid = r["cluster_id"]
        c_info = cluster_map.get(cid, {})
        r_copy = dict(r)
        r_copy["_id"] = str(r["_id"])
        r_copy["id"] = str(r["_id"])
        r_copy["display_name"] = c_info.get("display_name", "Chess Weakness")
        r_copy["human_label"] = c_info.get("human_label", "tactical")
        result.append(r_copy)

    return result
