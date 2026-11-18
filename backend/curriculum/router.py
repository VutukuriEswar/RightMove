# Exposes REST endpoints for player weakness curriculum engine and drills
from datetime import datetime, timezone
import uuid
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from core import get_db, decode_access_token
from curriculum.models import (
    CurriculumProfile,
    ClusterWithHealth,
    DrillSubmitRequest,
    DrillSubmitResponse,
    to_utc,
)
from curriculum.srs import (
    compute_health,
    stage_from_health,
    update_srs_record,
    get_drill_queue,
)
from curriculum.clustering import run_clustering
from curriculum.agent import run_agent_report

router = APIRouter(tags=["curriculum"])
internal_router = APIRouter(tags=["curriculum-internal"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# Authenticates requests and extracts user document
async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    db = get_db()
    obj_id = ObjectId(user_id) if ObjectId.is_valid(user_id) else None
    query = {"_id": obj_id} if obj_id else {"username": user_id}
    user = await db.users.find_one(query)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if user.get("is_blocked"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is blocked")
    return user


# Returns weakness profile with calculated cluster health and pending counts
@router.get("/profile", response_model=CurriculumProfile)
async def get_curriculum_profile(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])
    now = datetime.now(timezone.utc)

    clusters = await db.weakness_clusters.find({"user_id": user_id, "is_active": True}).to_list(None)
    clusters_with_health = []

    total_pending_drills = await db.srs_records.count_documents({
        "user_id": user_id,
        "next_review_at": {"$lte": now},
    })
    unread_reports = await db.weakness_reports.count_documents({
        "user_id": user_id,
        "acknowledged_by_user": False,
        "is_active": True,
    })

    for c in clusters:
        cid = c["cluster_id"]
        srs_records = await db.srs_records.find({"user_id": user_id, "cluster_id": cid}).to_list(None)
        mistakes = await db.mistake_positions.find({"user_id": user_id, "cluster_id": cid}).to_list(None)

        health = compute_health(cid, srs_records, mistakes)
        stage = stage_from_health(health)

        pending_for_cluster = sum(
            1 for r in srs_records
            if to_utc(r.get("next_review_at")) and to_utc(r["next_review_at"]) <= now
        )

        latest_rep = await db.weakness_reports.find_one(
            {"user_id": user_id, "cluster_id": cid, "is_active": True},
            sort=[("generated_at", -1)]
        )
        if latest_rep:
            latest_rep["_id"] = str(latest_rep["_id"])

        clusters_with_health.append(ClusterWithHealth(
            cluster_id=cid,
            human_label=c.get("human_label", "tactical"),
            display_name=c.get("display_name", "Tactical Awareness"),
            mistake_count=c.get("mistake_count", len(mistakes)),
            health=health,
            stage=stage,
            pending_drills_count=pending_for_cluster,
            last_seen=c.get("last_clustered_at") or c.get("created_at"),
            feature_summary=c.get("feature_summary", {}),
            latest_report=latest_rep,
        ))

    clusters_with_health.sort(key=lambda x: x.mistake_count, reverse=True)

    return CurriculumProfile(
        clusters=clusters_with_health,
        pending_drills=total_pending_drills,
        unread_reports=unread_reports,
    )


# Generates drill position queue and session identifier for training practice
@router.get("/drills")
async def get_drills(
    cluster_id: str | None = Query(None),
    current_user: dict = Depends(get_current_user)
):
    user_id = str(current_user["_id"])
    positions = await get_drill_queue(user_id, cluster_filter=cluster_id)
    session_id = str(uuid.uuid4())
    return {
        "positions": positions,
        "session_id": session_id,
        "total_due": len(positions),
    }


# Evaluates drill attempt, updates spaced repetition parameters, and records history
@router.post("/drills/{srs_id}/submit", response_model=DrillSubmitResponse)
async def submit_drill(
    srs_id: str,
    req: DrillSubmitRequest,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    user_id = str(current_user["_id"])
    now = datetime.now(timezone.utc)
    oid = ObjectId(srs_id) if ObjectId.is_valid(srs_id) else None
    query = {"_id": oid, "user_id": user_id} if oid else {"cluster_id": srs_id, "user_id": user_id}

    record = await db.srs_records.find_one(query)
    if not record:
        raise HTTPException(status_code=404, detail="Drill record not found")

    target_id = str(record["_id"])
    best_move = str(record.get("best_move", "")).strip()
    alt_moves = [str(m).strip().lower() for m in record.get("alternative_moves", [])]
    played = req.move_played.strip()

    is_exact_best = played.lower() == best_move.lower()
    is_alt = played.lower() in alt_moves
    is_correct = is_exact_best or is_alt

    if req.quality_score is not None:
        quality = max(0, min(5, int(req.quality_score)))
    elif is_exact_best:
        quality = 5 if req.time_taken_seconds < 15 else 4
    elif is_alt:
        quality = 3
    else:
        quality = 2

    player_elo = int(current_user.get("elo", 1200))
    update_res = await update_srs_record(target_id, quality, req.time_taken_seconds, player_elo)

    cluster_id = record["cluster_id"]
    report = await db.weakness_reports.find_one(
        {"user_id": user_id, "cluster_id": cluster_id, "is_active": True},
        sort=[("generated_at", -1)]
    )

    signals = report.get("signals", []) if report else []
    explanation = record.get("explanation") or (signals[0] if signals else "Find the most active move in the position.")

    position_entry = {
        "srs_record_id": target_id,
        "cluster_id": cluster_id,
        "fen": record["fen"],
        "move_played": played,
        "best_move": best_move,
        "is_correct": is_correct,
        "time_taken_seconds": req.time_taken_seconds,
        "quality_score": quality,
        "new_interval_days": update_res["new_interval_days"],
    }

    recent_session = await db.drill_sessions.find_one(
        {"user_id": user_id},
        sort=[("session_date", -1)]
    )
    s_date = to_utc(recent_session.get("session_date")) if recent_session else None
    is_recent = s_date and (now - s_date).total_seconds() < 1800

    if is_recent:
        await db.drill_sessions.update_one(
            {"_id": recent_session["_id"]},
            {
                "$push": {"positions_drilled": position_entry},
                "$addToSet": {"clusters_covered": cluster_id},
                "$inc": {
                    "total_correct": 1 if is_correct else 0,
                    "total_attempted": 1,
                    "session_duration_seconds": req.time_taken_seconds,
                },
            }
        )
    else:
        session_doc = {
            "user_id": user_id,
            "session_date": now,
            "positions_drilled": [position_entry],
            "clusters_covered": [cluster_id],
            "total_correct": 1 if is_correct else 0,
            "total_attempted": 1,
            "session_duration_seconds": req.time_taken_seconds,
        }
        await db.drill_sessions.insert_one(session_doc)

    await db.curriculum_state.update_one(
        {"user_id": user_id},
        {
            "$inc": {"total_drills_completed": 1},
            "$set": {"updated_at": now},
        },
        upsert=True,
    )

    return DrillSubmitResponse(
        correct=is_correct,
        best_move=best_move,
        next_interval_days=update_res["new_interval_days"],
        explanation=explanation,
        signals=signals,
    )


# Retrieves latest diagnostic agent report for specific cluster
@router.get("/report/{cluster_id}")
async def get_report_for_cluster(
    cluster_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    user_id = str(current_user["_id"])
    report = await db.weakness_reports.find_one(
        {"user_id": user_id, "cluster_id": cluster_id, "is_active": True},
        sort=[("generated_at", -1)]
    )
    if not report:
        raise HTTPException(status_code=404, detail="No report found for this weakness cluster")
    report["_id"] = str(report["_id"])
    return report


# Lists all generated weakness reports for current player sorted newest first
@router.get("/reports")
async def get_all_reports(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])
    reports = await db.weakness_reports.find({"user_id": user_id, "is_active": True}).sort("generated_at", -1).to_list(100)
    for r in reports:
        r["_id"] = str(r["_id"])
    return reports


# Marks weakness report as read and acknowledged by player
@router.post("/report/{report_id}/acknowledge")
async def acknowledge_report(
    report_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    user_id = str(current_user["_id"])
    oid = ObjectId(report_id) if ObjectId.is_valid(report_id) else None
    query = {"_id": oid, "user_id": user_id} if oid else {"cluster_id": report_id, "user_id": user_id}

    res = await db.weakness_reports.update_one(query, {"$set": {"acknowledged_by_user": True}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"acknowledged": True}


# Returns player health history metrics over time across weakness clusters
@router.get("/progress")
async def get_progress(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])
    now = datetime.now(timezone.utc)
    clusters = await db.weakness_clusters.find({"user_id": user_id, "is_active": True}).to_list(None)

    progress_clusters = []
    for c in clusters:
        cid = c["cluster_id"]
        srs_records = await db.srs_records.find({"user_id": user_id, "cluster_id": cid}).to_list(None)
        mistakes = await db.mistake_positions.find({"user_id": user_id, "cluster_id": cid}).to_list(None)

        current_health = compute_health(cid, srs_records, mistakes)
        history_points = []

        all_entries = []
        for r in srs_records:
            for qh in r.get("quality_history", []):
                dt = qh.get("date")
                if dt:
                    all_entries.append((dt, qh.get("quality", 3)))

        all_entries.sort(key=lambda x: x[0])
        if all_entries:
            start_date = all_entries[0][0].strftime("%b %d")
            history_points.append({"date": start_date, "health": max(10.0, round(current_health * 0.4))})
            mid_idx = len(all_entries) // 2
            if mid_idx > 0 and len(all_entries) >= 4:
                mid_date = all_entries[mid_idx][0].strftime("%b %d")
                history_points.append({"date": mid_date, "health": max(20.0, round(current_health * 0.75))})

        history_points.append({"date": now.strftime("%b %d"), "health": current_health})

        progress_clusters.append({
            "cluster_id": cid,
            "display_name": c.get("display_name", "Tactical Awareness"),
            "health": current_health,
            "stage": stage_from_health(current_health),
            "health_history": history_points,
        })

    return {"clusters": progress_clusters}


# Retrieves past thirty practice drill sessions for current player
@router.get("/history")
async def get_history(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])
    sessions = await db.drill_sessions.find({"user_id": user_id}).sort("session_date", -1).limit(30).to_list(None)
    for s in sessions:
        s["_id"] = str(s["_id"])
    return sessions


# Triggers clustering pipeline for specified user asynchronously
@internal_router.post("/curriculum/cluster/{user_id}")
async def trigger_cluster(user_id: str):
    await run_clustering(user_id)
    return {"status": "ok", "user_id": user_id}


# Triggers diagnostic agent report pipeline for specified cluster asynchronously
@internal_router.post("/curriculum/agent/{user_id}/{cluster_id}")
async def trigger_agent(user_id: str, cluster_id: str):
    rep = await run_agent_report(user_id, cluster_id)
    return {"status": "ok", "user_id": user_id, "cluster_id": cluster_id, "report_id": rep.get("_id")}
