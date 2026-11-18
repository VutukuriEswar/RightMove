# Clusters player mistakes and assigns chess weakness taxonomy labels
import asyncio
from datetime import datetime, timezone
import uuid
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from core import get_db

LABEL_VOCAB = {
    ("endgame", "rook", None): ("rook_endgame_activity", "Rook Activation in Endgames"),
    ("endgame", "pawn", None): ("pawn_endgame_technique", "Pawn Endgame Technique"),
    ("endgame", "king", None): ("king_activation_endgame", "King Activity in Endgames"),
    ("endgame", "queen", None): ("queen_endgame_technique", "Queen Endgame Precision"),
    ("middlegame", "queen", None): ("queen_coordination", "Queen Coordination"),
    ("middlegame", "bishop", None): ("bishop_exploitation", "Bishop Pair Exploitation"),
    ("middlegame", "knight", None): ("knight_outpost", "Knight Outpost Play"),
    ("middlegame", "rook", None): ("rook_activation_mid", "Rook Activation in Middlegame"),
    (None, None, "isolated"): ("isolated_pawn_handling", "Isolated Pawn Positions"),
    (None, None, "passed"): ("passed_pawn_conversion", "Passed Pawn Conversion"),
    ("middlegame", None, "open"): ("open_position_tactics", "Tactical Play in Open Positions"),
    ("middlegame", None, "closed"): ("closed_position_planning", "Planning in Closed Positions"),
    (None, None, "king_exp"): ("king_safety_defense", "King Safety & Defense"),
    (None, None, "winning"): ("converting_advantage", "Converting Winning Positions"),
    ("opening", None, None): ("opening_mistakes", "Opening Phase Mistakes"),
    (None, None, None): ("general_tactical", "General Tactical Awareness"),
}


# Maps centroid feature values into human-readable label and display name
def label_cluster(centroid_raw: np.ndarray) -> tuple[str, str]:
    phase_val = centroid_raw[24] * 2.0
    phase_str = "opening" if phase_val < 0.5 else ("endgame" if phase_val > 1.5 else "middlegame")

    piece_counts = {
        "queen": float(centroid_raw[2]),
        "rook": float(centroid_raw[3]),
        "bishop": float(centroid_raw[4]),
        "knight": float(centroid_raw[5]),
    }
    max_piece_val = max(piece_counts.values())
    dominant_piece = max(piece_counts, key=piece_counts.get) if max_piece_val > 0.5 else None

    has_isolated = (centroid_raw[6] + centroid_raw[7]) > 0.3
    has_passed = (centroid_raw[10] + centroid_raw[11]) > 0.3
    king_exposed = (centroid_raw[21] + centroid_raw[23]) > 0.5
    is_winning = abs(centroid_raw[1] * 9.0) > 2.0
    is_open = centroid_raw[19] > 0.5
    is_closed = centroid_raw[19] <= 0.25

    struct_flag = None
    if has_isolated:
        struct_flag = "isolated"
    elif has_passed:
        struct_flag = "passed"
    elif king_exposed:
        struct_flag = "king_exp"
    elif is_winning:
        struct_flag = "winning"
    elif is_open:
        struct_flag = "open"
    elif is_closed and phase_str == "middlegame":
        struct_flag = "closed"

    key = (phase_str, dominant_piece, struct_flag)
    if key in LABEL_VOCAB:
        return LABEL_VOCAB[key]
    key2 = (phase_str, dominant_piece, None)
    if key2 in LABEL_VOCAB:
        return LABEL_VOCAB[key2]
    key3 = (None, None, struct_flag)
    if key3 in LABEL_VOCAB:
        return LABEL_VOCAB[key3]
    key4 = (phase_str, None, None)
    if key4 in LABEL_VOCAB:
        return LABEL_VOCAB[key4]
    return LABEL_VOCAB[(None, None, None)]


# Generates structured summary description of centroid characteristics
def summarize_centroid(centroid_raw: np.ndarray) -> dict:
    phase_val = centroid_raw[24] * 2.0
    phase_str = "opening" if phase_val < 0.5 else ("endgame" if phase_val > 1.5 else "middlegame")
    mat_diff = centroid_raw[1] * 9.0
    mat_bal = "white_ahead" if mat_diff > 1.5 else ("black_ahead" if mat_diff < -1.5 else "even")

    pieces = []
    if centroid_raw[2] >= 1.0:
        pieces.append("queen")
    if centroid_raw[3] >= 1.5:
        pieces.append("rook")
    if centroid_raw[4] >= 1.5:
        pieces.append("bishop")
    if centroid_raw[5] >= 1.5:
        pieces.append("knight")
    if not pieces:
        piece_counts = {"queen": centroid_raw[2], "rook": centroid_raw[3], "bishop": centroid_raw[4], "knight": centroid_raw[5]}
        dom = max(piece_counts, key=piece_counts.get)
        if piece_counts[dom] > 0.2:
            pieces.append(dom)

    open_files = bool(centroid_raw[19] > 0.3)
    king_safety = "exposed" if (centroid_raw[21] + centroid_raw[23]) > 0.5 else "stable"

    return {
        "game_phase": phase_str,
        "material_balance": mat_bal,
        "dominant_pieces": pieces,
        "open_files": open_files,
        "king_safety": king_safety,
    }


# Persists cluster definitions and assigns cluster identifiers to mistakes
async def upsert_clusters(user_id: str, clusters_data: list, all_mistakes: list, labels: np.ndarray):
    db = get_db()
    now = datetime.now(timezone.utc)
    cluster_id_map = {}

    for c in clusters_data:
        cid = c["cluster_index"]
        human_label = c["human_label"]

        existing = await db.weakness_clusters.find_one({
            "user_id": user_id,
            "human_label": human_label,
            "is_active": True,
        })

        if existing:
            cluster_id = existing["cluster_id"]
            first_seen_at = existing.get("first_seen_at") or existing.get("created_at") or now
            last_reported = existing.get("last_reported_at")
            prev_count = existing.get("mistake_count", 0)
            since_report = existing.get("mistake_count_since_report", 0) + max(0, c["mistake_count"] - prev_count)
        else:
            cluster_id = str(uuid.uuid4())
            first_seen_at = now
            last_reported = None
            since_report = c["mistake_count"]

        cluster_id_map[cid] = cluster_id

        doc = {
            "user_id": user_id,
            "cluster_id": cluster_id,
            "centroid_normalized": c["centroid_normalized"],
            "centroid_raw": c["centroid_raw"],
            "representative_fens": c["representative_fens"],
            "human_label": human_label,
            "display_name": c["display_name"],
            "feature_summary": c["feature_summary"],
            "mistake_count": c["mistake_count"],
            "mistake_count_since_report": since_report,
            "mistake_rate_trend": c.get("mistake_rate_trend", "stable"),
            "last_reported_at": last_reported,
            "last_clustered_at": now,
            "first_seen_at": first_seen_at,
            "is_active": True,
            "created_at": existing.get("created_at", now) if existing else now,
        }

        await db.weakness_clusters.update_one(
            {"user_id": user_id, "cluster_id": cluster_id},
            {"$set": doc},
            upsert=True,
        )

    for idx, mistake in enumerate(all_mistakes):
        assigned_cid = int(labels[idx])
        target_cluster_id = cluster_id_map.get(assigned_cid)
        if target_cluster_id:
            await db.mistake_positions.update_one(
                {"_id": mistake["_id"]},
                {"$set": {"cluster_id": target_cluster_id, "clustered_at": now}}
            )

    await db.curriculum_state.update_one(
        {"user_id": user_id},
        {"$set": {
            "last_clustered_at": now,
            "pending_cluster_run": False,
            "games_since_last_cluster": 0,
            "updated_at": now,
        }},
        upsert=True,
    )

    from curriculum.agent import run_agent_report
    user_clusters = await db.weakness_clusters.find({"user_id": user_id, "is_active": True}).to_list(None)
    for cluster in user_clusters:
        last_rep = cluster.get("last_reported_at")
        mistake_cnt = cluster.get("mistake_count", 0)
        since_rep = cluster.get("mistake_count_since_report", 0)
        trend = cluster.get("mistake_rate_trend", "stable")

        if last_rep and last_rep.tzinfo is None:
            last_rep = last_rep.replace(tzinfo=timezone.utc)
        days_since_rep = (now - last_rep).days if last_rep else 999
        should_report = (
            mistake_cnt >= 10 and (
                last_rep is None
                or trend == "increasing"
                or (days_since_rep >= 14 and since_rep >= 5)
            )
        )
        if should_report:
            asyncio.create_task(run_agent_report(user_id, cluster["cluster_id"]))


# Runs k-means clustering over accumulated user mistake feature vectors
async def run_clustering(user_id: str):
    db = get_db()
    all_mistakes = await db.mistake_positions.find({"user_id": user_id}).to_list(None)

    if len(all_mistakes) < 5:
        return

    vectors = np.array([m["feature_vector"] for m in all_mistakes], dtype=np.float32)

    scaler = StandardScaler()
    vectors_norm = scaler.fit_transform(vectors)

    k = min(6, max(2, int(np.sqrt(len(all_mistakes) / 5.0))))

    km = KMeans(n_clusters=k, n_init=10, random_state=42)
    labels = km.fit_predict(vectors_norm)

    clusters_data = []
    for cid in range(k):
        mask = labels == cid
        indices = np.where(mask)[0]
        if len(indices) == 0:
            continue
        centroid = km.cluster_centers_[cid]
        dists = np.linalg.norm(vectors_norm[indices] - centroid, axis=1)
        top3_idx = indices[np.argsort(dists)[:3]]

        rep_fens = [all_mistakes[i]["fen_before"] for i in top3_idx]
        raw_centroid = scaler.inverse_transform([centroid])[0]

        label, display_name = label_cluster(raw_centroid)
        feature_summary = summarize_centroid(raw_centroid)

        clusters_data.append({
            "cluster_index": cid,
            "centroid_normalized": centroid.tolist(),
            "centroid_raw": raw_centroid.tolist(),
            "representative_fens": rep_fens,
            "mistake_count": int(mask.sum()),
            "human_label": label,
            "display_name": display_name,
            "feature_summary": feature_summary,
        })

    await upsert_clusters(user_id, clusters_data, all_mistakes, labels)
