# Exposes REST API for auth, games, coaching and training.
import base64
from fastapi import APIRouter, HTTPException, Depends, status, UploadFile, File
from bson import ObjectId
from fastapi.security import OAuth2PasswordBearer
from core import hash_password, verify_password, create_access_token, decode_access_token
from core import get_db
from core import (get_db_storage, pgn_put, pgn_get_text, pgn_delete, open_pgn_stream)
from core import UserDoc
from core import SignupRequest, LoginRequest, TokenResponse, UserPublic, UpdateProfileRequest
from fastapi import APIRouter, HTTPException, Depends
from core import GameDoc
from core import CreateGameRequest, GamePublic, GameSummaryPublic, UserStatsPublic
from core import FriendshipDoc
from core import FriendRequest, FriendshipPublic, ChallengeRequest
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from engines import analyze_position
from core import AnalysisResult
import logging
import random
from typing import Optional
from intelligence import HintSystem, TacticalMotifDetector, get_concepts
from intelligence import MoveExplainer, LessonGenerator
from intelligence import GMHistoricalMatcher
from intelligence import PositionalEvaluator, EvaluationAnalyzer
from intelligence import FutureSimulator
from gm import GMPolicyValueNet
from gm import (list_models as gm_list_models, get_model_doc as gm_get_model_doc,
                    upsert_model as gm_upsert_model, delete_model_doc as gm_delete_model_doc,
                    evict_model as gm_evict_model, load_gm_model as gm_load_gm_model,
                    load_error as gm_load_error_of, DEFAULT_GM_PGN)
from engines import AsyncEngineProxy
import os
import tempfile
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from intelligence import (
    GameReport, GameSummary, WeaknessDetector, StyleAnalyzer,
    TrainingPlan, OpeningRecommender, OpeningDetector, PDFReport,
)
from intelligence import GameAnalyzer
import io
import chess
import chess.pgn
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from intelligence import PositionalEvaluator
from engines import eval_to_win_prob
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import PlainTextResponse, Response
from broadcasts import (
    BroadcastError,
    analysis_status as broadcast_analysis_status,
    analyze_position_for_broadcast,
    enqueue_full_event_analysis as broadcast_enqueue_full_event,
    enqueue_game as broadcast_enqueue_game,
    enqueue_round_games as broadcast_enqueue_round_games,
    event_analysis_progress as broadcast_event_analysis_progress,
    get_player_avatar as broadcast_get_player_avatar,
    get_round as broadcast_get_round,
    get_round_analysis_map as broadcast_analysis_map,
    get_round_pgn as broadcast_get_round_pgn,
    get_tournament as broadcast_get_tournament,
    list_live as broadcast_list_live,
    list_top as broadcast_list_top,
    prioritize_game_analysis as broadcast_prioritize_game,
    public_analysis as broadcast_public_analysis,
    search_events as broadcast_search_events,
    track_tour as broadcast_track_tour,
    track_top_events as broadcast_track_top_events,
)

# Section api/auth

auth_router = APIRouter(prefix="/auth", tags=["auth"])


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# Resolves current user from bearer token
async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    db = get_db()

    try:
        obj_id = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user ID format")

    user = await db.users.find_one({"_id": obj_id})
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if user.get("is_blocked"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is blocked")
    return user

# Enforces admin access for protected routes
async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user

# Converts user dict to public schema
def _to_public(current_user: dict) -> "UserPublic":
    return UserPublic(
        id=str(current_user["_id"]),
        username=current_user["username"],
        display_name=current_user.get("display_name"),
        email=current_user["email"],
        created_at=current_user["created_at"],
        avatar_url=current_user.get("avatar_url"),
        bio=current_user.get("bio"),
        role=current_user.get("role", "user"),
        is_blocked=bool(current_user.get("is_blocked", False)),
    )

# Registers new user account
@auth_router.post("/signup", response_model=TokenResponse, status_code=201)
async def signup(body: SignupRequest):
    db = get_db()
    if await db.users.find_one({"email": body.email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    if await db.users.find_one({"username": body.username}):
        raise HTTPException(status_code=409, detail="Username already taken")

    user = UserDoc(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
    )
    user_dict = user.model_dump(exclude={"id"})
    result = await db.users.insert_one(user_dict)
    user_id = str(result.inserted_id)

    token = create_access_token(user_id)
    return TokenResponse(access_token=token)

# Authenticates user and issues token
@auth_router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    db = get_db()
    user = await db.users.find_one({"email": body.email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("is_blocked"):
        raise HTTPException(status_code=403, detail="Account is blocked")

    token = create_access_token(str(user["_id"]))
    return TokenResponse(access_token=token)

# Returns current user profile
@auth_router.get("/me", response_model=UserPublic)
async def get_me(current_user: dict = Depends(get_current_user)):
    return _to_public(current_user)

# Records user activity heartbeat
@auth_router.post("/heartbeat")
async def heartbeat(current_user: dict = Depends(get_current_user)):
    db = get_db()
    await db.users.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"last_seen": datetime.now(timezone.utc)}},
    )
    return {"status": "ok"}

# Updates current user profile
@auth_router.patch("/me", response_model=UserPublic)
async def update_me(
    body: UpdateProfileRequest,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    updates: dict = {}

    if body.display_name is not None:
        updates["display_name"] = body.display_name.strip() or None

    if body.email is not None and body.email != current_user["email"]:
        if await db.users.find_one({"email": body.email}):
            raise HTTPException(status_code=409, detail="Email already in use")
        updates["email"] = body.email

    if body.bio is not None:
        updates["bio"] = body.bio.strip() or None

    if body.new_password:
        if not body.current_password:
            raise HTTPException(status_code=422, detail="current_password is required to set a new password")
        if not verify_password(body.current_password, current_user["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
        updates["password_hash"] = hash_password(body.new_password)

    if updates:
        await db.users.update_one(
            {"_id": current_user["_id"]},
            {"$set": updates},
        )

    updated = await db.users.find_one({"_id": current_user["_id"]})
    return _to_public(updated)

# Accepts avatar upload and stores data URL
@auth_router.post("/me/avatar", response_model=UserPublic)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="File must be an image")

    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be under 2 MB")

    ext = file.content_type.split("/")[1].split("+")[0]
    data_url = f"data:{file.content_type};base64,{base64.b64encode(data).decode()}"

    await db.users.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"avatar_url": data_url}},
    )

    updated = await db.users.find_one({"_id": current_user["_id"]})
    return _to_public(updated)

# Normalizes Mongo datetime to UTC-aware for serialization
def _as_utc(value):
    if value is None:
        return None
    try:
        if getattr(value, "tzinfo", None) is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    except Exception:
        return value

# Section api/games

games_router = APIRouter(prefix="/games", tags=["games"])


# Chooses engine for coach game
def _pick_coach_engine() -> str:
    try:
        import maia3  # noqa: F401
        return "maia3"
    except Exception:
        return "stockfish"

# Creates game via POST /games/
@games_router.post("/", response_model=GamePublic, status_code=201)
async def create_game(body: CreateGameRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])

    white_id = None
    black_id = None
    if body.mode == "friend" and body.friend_username:
        friend = await db.users.find_one({"username": body.friend_username})
        if not friend:
            raise HTTPException(status_code=404, detail="Friend not found")
        black_id = str(friend["_id"])

    bot_engine = body.bot_engine
    bot_depth = body.bot_depth
    maia_elo = body.maia_elo
    bot_level = body.bot_level
    player_color = body.player_color or "white"
    if body.mode == "bot":
        bot_engine = bot_engine or _pick_coach_engine()
        if bot_engine == "stockfish":
            if bot_depth is None:
                bot_depth = max(1, min(20, (bot_level or 5) * 2))
            bot_depth = max(1, min(20, bot_depth))
        else:
            if maia_elo is None:
                maia_elo = 1100 + ((bot_level or 5) - 1) * 100 if bot_level else 1500
            maia_elo = max(800, min(2500, maia_elo))
        if player_color == "black":
            white_id, black_id = None, user_id
        else:
            player_color = "white"
            white_id, black_id = user_id, None

    game = GameDoc(
        white_id=white_id,
        black_id=black_id,
        mode=body.mode,
        bot_engine=bot_engine,
        bot_level=bot_level,
        bot_depth=bot_depth,
        maia_elo=maia_elo,
        player_color=player_color if body.mode == "bot" else None,
        training_mode=body.training_mode,
        time_control_seconds=body.time_control_seconds,
        increment_seconds=body.increment_seconds,
    )
    game_dict = game.model_dump(exclude={"id"})
    result = await db.games.insert_one(game_dict)
    game_dict["_id"] = result.inserted_id

    return _game_to_public(game_dict)

# Returns WDL record for current user
@games_router.get("/mine/stats", response_model=UserStatsPublic)
async def get_my_stats(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])
    wins = draws = losses = 0
    cursor = db.games.find(
        {
            "$or": [{"white_id": user_id}, {"black_id": user_id}],
            "result": {"$in": ["white", "black", "draw"]},
        },
        {"white_id": 1, "black_id": 1, "result": 1},
    )
    async for game in cursor:
        result = game.get("result")
        if result == "draw":
            draws += 1
        elif (
            (result == "white" and game.get("white_id") == user_id)
            or (result == "black" and game.get("black_id") == user_id)
        ):
            wins += 1
        else:
            losses += 1
    return UserStatsPublic(
        wins=wins, draws=draws, losses=losses, games_played=wins + draws + losses
    )

# Lists finished games for current user
@games_router.get("/mine/history")
async def get_my_history(
    limit: int = 50,
    skip: int = 0,
    current_user: dict = Depends(get_current_user),
):
    from bson import ObjectId as _OID
    db = get_db()
    user_id = str(current_user["_id"])
    limit = max(1, min(int(limit or 50), 100))
    skip = max(0, int(skip or 0))

    cursor = db.games.find(
        {
            "$or": [{"white_id": user_id}, {"black_id": user_id}],
            "result": {"$in": ["white", "black", "draw", "aborted"]},
        },
        {"white_id": 1, "black_id": 1, "mode": 1, "result": 1,
         "started_at": 1, "time_control_seconds": 1, "increment_seconds": 1, "moves": 1},
    ).sort("started_at", -1).skip(skip).limit(limit)
    docs = await cursor.to_list(limit)

    ids = set()
    for g in docs:
        for k in ("white_id", "black_id"):
            v = g.get(k)
            if v and v != user_id and v != "None":
                ids.add(v)
    names = {}
    if ids:
        try:
            oids = [ _OID(i) for i in ids ]
            async for u in db.users.find({"_id": {"$in": oids}}, {"username": 1}):
                names[str(u["_id"])] = u["username"]
        except Exception:
            pass

    out = []
    for g in docs:
        res = g.get("result")
        if res == "draw":
            mine = "draw"
        elif (res == "white" and g.get("white_id") == user_id) or (
            res == "black" and g.get("black_id") == user_id
        ):
            mine = "win"
        else:
            mine = "loss"
        opp_id = g.get("black_id") if g.get("white_id") == user_id else g.get("white_id")
        out.append({
            "id": str(g["_id"]),
            "mode": g.get("mode"),
            "result": res,
            "mine": mine,
            "opponent": names.get(opp_id) if opp_id else None,
            "opponent_id": opp_id,
            "started_at": _as_utc(g.get("started_at")),
            "time_control_seconds": g.get("time_control_seconds", 600),
            "increment_seconds": g.get("increment_seconds", 0),
            "moves_count": len(g.get("moves") or []),
            "has_moves": bool(g.get("moves")),
        })
    return {"games": out, "limit": limit, "skip": skip}

# Validates paused-game access for owner
async def _paused_game_or_404(db, game_id: str, user_id: str):
    from bson import ObjectId as _OID
    try:
        oid = _OID(game_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Game not found")
    game = await db.games.find_one({"_id": oid})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.get("mode") != "bot":
        raise HTTPException(status_code=400, detail="Only coach games can be paused")
    if game.get("result") != "ongoing":
        raise HTTPException(status_code=400, detail="Game is already finished")
    if user_id not in (game.get("white_id"), game.get("black_id")):
        raise HTTPException(status_code=403, detail="Not your game")
    return game

# Lists paused coach games for current user
@games_router.get("/mine/paused")
async def get_paused_games(current_user: dict = Depends(get_current_user)):
    db = get_db()
    cursor = db.paused_games.find(
        {"user_id": str(current_user["_id"])}
    ).sort("paused_at", -1).limit(100)
    docs = await cursor.to_list(100)
    out = []
    for d in docs:
        moves = d.get("moves") or []
        out.append({
            "game_id": d["game_id"],
            "paused_at": _as_utc(d.get("paused_at")),
            "bot_engine": d.get("bot_engine"),
            "bot_depth": d.get("bot_depth"),
            "maia_elo": d.get("maia_elo"),
            "player_color": d.get("player_color"),
            "training_mode": d.get("training_mode", False),
            "time_control_seconds": d.get("time_control_seconds", 600),
            "increment_seconds": d.get("increment_seconds", 0),
            "moves_count": len(moves),
            "fen": d.get("fen"),
        })
    return {"games": out}

# Pauses live coach game and snapshots state
@games_router.post("/{game_id}/pause")
async def pause_game(game_id: str, current_user: dict = Depends(get_current_user)):
    from realtime import _get_state, live_clocks
    db = get_db()
    user_id = str(current_user["_id"])
    game = await _paused_game_or_404(db, game_id, user_id)
    state = _get_state(game_id)
    if state is None or state.result:
        raise HTTPException(status_code=409, detail="Game is not live right now")
    state.clock_running = False
    clocks = live_clocks(state)
    await db.paused_games.replace_one(
        {"game_id": game_id},
        {
            "game_id": game_id,
            "user_id": user_id,
            "fen": state.board.fen(),
            "moves": state.moves,
            "clocks": clocks,
            "time_control_seconds": game.get("time_control_seconds", 600),
            "increment_seconds": game.get("increment_seconds", 0),
            "bot_engine": game.get("bot_engine"),
            "bot_depth": game.get("bot_depth"),
            "maia_elo": game.get("maia_elo"),
            "player_color": game.get("player_color"),
            "training_mode": game.get("training_mode", False),
            "paused_at": datetime.now(timezone.utc),
        },
        upsert=True,
    )
    return {"status": "paused", "game_id": game_id}

# Resumes paused coach game
@games_router.post("/{game_id}/resume")
async def resume_game(game_id: str, current_user: dict = Depends(get_current_user)):
    from realtime import _get_state, _ensure_clock_task, restore_paused_state
    import time as _time
    db = get_db()
    user_id = str(current_user["_id"])
    await _paused_game_or_404(db, game_id, user_id)
    snap = await db.paused_games.find_one({"game_id": game_id})
    if not snap:
        raise HTTPException(status_code=404, detail="No paused snapshot for this game")
    state = _get_state(game_id)
    if state is None or state.result:
        state = await restore_paused_state(game_id)
    if state is None:
        raise HTTPException(status_code=409, detail="Could not restore game")
    state.last_move_time = _time.time()
    state.clock_running = True
    _ensure_clock_task(game_id, state)
    await db.paused_games.delete_one({"game_id": game_id})
    return {"status": "resumed", "game_id": game_id}

# Resigns paused coach game without resuming
@games_router.post("/{game_id}/resign-paused")
async def resign_paused_game(game_id: str, current_user: dict = Depends(get_current_user)):
    from realtime import _get_state, _end_game
    db = get_db()
    user_id = str(current_user["_id"])
    game = await _paused_game_or_404(db, game_id, user_id)
    snap = await db.paused_games.find_one({"game_id": game_id})
    if not snap:
        raise HTTPException(status_code=404, detail="No paused snapshot for this game")
    winner = "black" if game.get("white_id") == user_id else "white"
    moves = snap.get("moves") or []
    state = _get_state(game_id)
    if state is not None and not state.result:
        await _end_game(game_id, state, winner)
    else:
        from bson import ObjectId as _OID
        await db.games.update_one(
            {"_id": _OID(game_id)},
            {"$set": {"result": winner, "moves": moves}},
        )
    await db.paused_games.delete_one({"game_id": game_id})
    return {"status": "resigned", "game_id": game_id, "result": winner}

# Parses PGN text into validated move list and board
def _parse_pgn_moves(pgn_text: str):
    import io
    import chess
    import chess.pgn
    try:
        pgn_game = chess.pgn.read_game(io.StringIO(pgn_text.strip()))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PGN parse error: {e}")
    if not pgn_game:
        raise HTTPException(status_code=400, detail="Invalid PGN file format")
    board = pgn_game.board()
    moves_list = []
    for node in pgn_game.mainline():
        move = node.move
        if move not in board.legal_moves:
            raise HTTPException(status_code=400, detail=f"Illegal move in PGN: {move.uci()}")
        san = board.san(move)
        uci_str = move.uci()
        board.push(move)
        moves_list.append({
            "ply": len(moves_list) + 1,
            "san": san,
            "uci": uci_str,
            "from_sq": uci_str[:2],
            "to_sq": uci_str[2:4],
            "time_spent_ms": 0,
            "elapsed_ms": 0,
            "clock_remaining_ms": 0,
            "fen": board.fen(),
        })
    if len(moves_list) == 0:
        raise HTTPException(status_code=400, detail="PGN file contains no moves")
    if board.is_game_over():
        raise HTTPException(status_code=400, detail="This PGN game is already completed")
    turn_color = "white" if board.turn == chess.WHITE else "black"
    return moves_list, board, turn_color

# Creates new coach game from imported PGN
@games_router.post("/import-pgn")
async def import_pgn_game(body: dict, current_user: dict = Depends(get_current_user)):
    pgn_text = str((body or {}).get("pgn", "") or "")
    if not pgn_text.strip():
        raise HTTPException(status_code=400, detail="PGN content is required")
    moves_list, board, turn_color = _parse_pgn_moves(pgn_text)
    user_id = str(current_user["_id"])
    white_id = user_id if turn_color == "white" else None
    black_id = user_id if turn_color == "black" else None
    bot_engine = (body.get("bot_engine") or "").lower() or _pick_coach_engine()
    if bot_engine not in ("stockfish", "maia3"):
        bot_engine = "stockfish"
    bot_depth = body.get("bot_depth") or 10
    maia_elo = body.get("maia_elo") or 1500
    db = get_db()
    game = GameDoc(
        white_id=white_id,
        black_id=black_id,
        mode="bot",
        bot_engine=bot_engine,
        bot_level=5,
        bot_depth=bot_depth,
        maia_elo=maia_elo,
        player_color=turn_color,
        training_mode=True,
        time_control_seconds=0,
        increment_seconds=0,
    )
    game_dict = game.model_dump(exclude={"id"})
    game_dict["fen"] = board.fen()
    game_dict["moves"] = moves_list
    result = await db.games.insert_one(game_dict)
    game_id = str(result.inserted_id)
    game_dict["_id"] = result.inserted_id

    from realtime import GameState, _set_state
    state = GameState(game_dict)
    _set_state(game_id, state)

    return {"id": game_id, "status": "ok", "moves_count": len(moves_list), "player_color": turn_color}

# Imports PGN moves into an existing empty coach game
@games_router.post("/{game_id}/import-pgn")
async def import_pgn_into_game(game_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    from bson import ObjectId as _OID
    from realtime import _get_state, manager, live_clocks
    pgn_text = str((body or {}).get("pgn", "") or "")
    if not pgn_text.strip():
        raise HTTPException(status_code=400, detail="PGN content is required")
    db = get_db()
    try:
        oid = _OID(game_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Game not found")
    game = await db.games.find_one({"_id": oid})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    user_id = str(current_user["_id"])
    if user_id not in (game.get("white_id"), game.get("black_id")):
        raise HTTPException(status_code=403, detail="Not your game")
    if game.get("mode") != "bot":
        raise HTTPException(status_code=400, detail="Only coach games can import PGN")
    if game.get("result") != "ongoing":
        raise HTTPException(status_code=400, detail="Game is already finished")
    existing_moves = game.get("moves") or []
    state = _get_state(game_id)
    if (state and len(state.moves) > 0) or len(existing_moves) > 0:
        raise HTTPException(status_code=400, detail="Cannot import PGN while game is already in progress")

    moves_list, board, turn_color = _parse_pgn_moves(pgn_text)
    white_id = user_id if turn_color == "white" else None
    black_id = user_id if turn_color == "black" else None

    await db.games.update_one(
        {"_id": oid},
        {"$set": {
            "fen": board.fen(),
            "moves": moves_list,
            "player_color": turn_color,
            "white_id": white_id,
            "black_id": black_id,
        }}
    )

    if state:
        state.board = board
        state.moves = moves_list
        state.redo_stack = []
        state.player_color = turn_color
        state.white_id = white_id
        state.black_id = black_id
        await manager.broadcast(game_id, {
            "type": "game_state",
            "payload": {
                "fen": state.board.fen(),
                "clocks": live_clocks(state),
                "moves": state.moves,
                "result": state.result,
                "can_takeback": bool(state.mode == "bot" and len(state.moves) > 0 and not state.result),
                "can_redo": False,
                "bot_engine": state.bot_engine,
                "bot_depth": state.bot_depth,
                "maia_elo": state.maia_elo,
                "player_color": state.player_color,
            },
        })

    return {
        "status": "ok",
        "game_id": game_id,
        "moves": moves_list,
        "fen": board.fen(),
        "player_color": turn_color,
    }

# Fetches game by identifier
@games_router.get("/{game_id}", response_model=GamePublic)
async def get_game(game_id: str):
    db = get_db()
    game = await db.games.find_one({"_id": ObjectId(game_id)})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    white_username = None
    black_username = None
    if game.get("white_id"):
        try:
            u = await db.users.find_one({"_id": ObjectId(game["white_id"])}, {"username": 1})
            white_username = u["username"] if u else None
        except Exception:
            pass
    if game.get("black_id"):
        try:
            u = await db.users.find_one({"_id": ObjectId(game["black_id"])}, {"username": 1})
            black_username = u["username"] if u else None
        except Exception:
            pass
    return _game_to_public(game, white_username=white_username, black_username=black_username)

# Fetches summary for game
@games_router.get("/{game_id}/summary", response_model=GameSummaryPublic)
async def get_game_summary(game_id: str):
    db = get_db()
    summary = await db.game_summaries.find_one({"game_id": game_id})
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not available yet")
    return GameSummaryPublic(
        game_id=summary["game_id"],
        accuracy_white=summary.get("accuracy_white"),
        accuracy_black=summary.get("accuracy_black"),
        summary_text=summary.get("summary_text"),
        key_moments=summary.get("key_moments", []),
    )

# Fetches persisted move log for game
@games_router.get("/{game_id}/moves")
async def get_game_moves(game_id: str, current_user: dict = Depends(get_current_user)):
    from bson import ObjectId as _OID
    try:
        oid = _OID(game_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Game not found")
    db = get_db()
    game = await db.games.find_one({"_id": oid})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    moves = game.get("moves") or []
    return {"game_id": game_id, "moves": moves, "result": game.get("result", "ongoing")}

# Submits annotated move log for game
@games_router.post("/{game_id}/summary")
async def submit_game_summary(
    game_id: str,
    moves_data: list[dict],
    current_user: dict = Depends(get_current_user),
):
    from intelligence import generate_summary
    db = get_db()

    game = await db.games.find_one({"_id": ObjectId(game_id)})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    white_username = "Guest"
    black_username = "Guest"

    if game.get("white_id") and game.get("white_id") != "None":
        white_doc = await db.users.find_one({"_id": ObjectId(game.get("white_id"))})
        if white_doc:
            white_username = white_doc["username"]

    if game.get("black_id") and game.get("black_id") != "None":
        black_doc = await db.users.find_one({"_id": ObjectId(game.get("black_id"))})
        if black_doc:
            black_username = black_doc["username"]

    summary = generate_summary(
        game_id=game_id,
        moves_data=moves_data,
        white_username=white_username,
        black_username=black_username,
    )

    await db.game_summaries.replace_one(
        {"game_id": game_id},
        summary.model_dump(),
        upsert=True,
    )

    return {"status": "ok", "game_id": game_id}

# Converts game dict to public schema
def _game_to_public(game: dict, white_username: str = None, black_username: str = None) -> GamePublic:
    return GamePublic(
        id=str(game["_id"]),
        white_id=str(game.get("white_id")) if game.get("white_id") else None,
        black_id=str(game.get("black_id")) if game.get("black_id") else None,
        white_username=white_username,
        black_username=black_username,
        mode=game["mode"],
        bot_engine=game.get("bot_engine"),
        bot_level=game.get("bot_level"),
        bot_depth=game.get("bot_depth"),
        maia_elo=game.get("maia_elo"),
        player_color=game.get("player_color"),
        training_mode=game.get("training_mode", False),
        result=game["result"],
        started_at=_as_utc(game["started_at"]),
        ended_at=_as_utc(game.get("ended_at")),
        time_control_seconds=game.get("time_control_seconds", 600),
        increment_seconds=game.get("increment_seconds", 0),
    )

# Swaps user and bot colors pre-game
@games_router.post("/{game_id}/choose-color", response_model=GamePublic)
async def choose_color(game_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    from bson import ObjectId as _OID
    db = get_db()
    try:
        oid = _OID(game_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Game not found")
    game = await db.games.find_one({"_id": oid})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.get("mode") != "bot":
        raise HTTPException(status_code=400, detail="Side swap is only available in bot games")
    try:
        from realtime import _get_state
        st = _get_state(game_id)
        if st is not None and len(getattr(st, "moves", [])) > 0:
            raise HTTPException(status_code=400, detail="Cannot swap sides after the game has started")
    except HTTPException:
        raise
    except Exception:
        pass
    color = str((body or {}).get("player_color", "")).lower()
    if color not in ("white", "black"):
        raise HTTPException(status_code=422, detail="player_color must be white or black")
    user_id = str(current_user["_id"])
    if color == "black":
        update = {"player_color": "black", "white_id": None, "black_id": user_id}
    else:
        update = {"player_color": "white", "white_id": user_id, "black_id": None}
    await db.games.update_one({"_id": oid}, {"$set": update})
    try:
        from realtime import _get_state as _gs
        st = _gs(game_id)
        if st is not None and len(getattr(st, "moves", [])) == 0:
            if color == "black":
                st.white_id, st.black_id = None, user_id
            else:
                st.white_id, st.black_id = user_id, None
    except Exception:
        pass
    game = await db.games.find_one({"_id": oid})
    return _game_to_public(game)

# Updates bot engine config pre-game
@games_router.patch("/{game_id}/bot-config", response_model=GamePublic)
async def update_bot_config(game_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    from bson import ObjectId as _OID
    db = get_db()
    try:
        oid = _OID(game_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Game not found")
    game = await db.games.find_one({"_id": oid})
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.get("mode") != "bot":
        raise HTTPException(status_code=400, detail="Engine setup is only available in bot games")
    try:
        from realtime import _get_state
        st = _get_state(game_id)
        if st is not None and len(getattr(st, "moves", [])) > 0:
            raise HTTPException(status_code=400, detail="Cannot change engine after the game has started")
    except HTTPException:
        raise
    except Exception:
        pass
    update: dict = {}
    engine = str((body or {}).get("bot_engine", "") or "").lower()
    if engine:
        if engine not in ("stockfish", "maia3"):
            raise HTTPException(status_code=422, detail="bot_engine must be stockfish or maia3")
        update["bot_engine"] = engine
    else:
        engine = game.get("bot_engine") or "stockfish"
    if engine == "maia3":
        elo = (body or {}).get("maia_elo", game.get("maia_elo", 1500))
        try:
            elo = int(elo)
        except Exception:
            raise HTTPException(status_code=422, detail="maia_elo must be an integer")
        update["maia_elo"] = max(800, min(2500, elo))
        update["bot_depth"] = None
    else:
        depth = (body or {}).get("bot_depth", game.get("bot_depth", 10))
        try:
            depth = int(depth)
        except Exception:
            raise HTTPException(status_code=422, detail="bot_depth must be an integer")
        update["bot_depth"] = max(1, min(20, depth))
        update["maia_elo"] = None
    await db.games.update_one({"_id": oid}, {"$set": update})
    try:
        from realtime import _get_state as _gs
        st = _gs(game_id)
        if st is not None and len(getattr(st, "moves", [])) == 0:
            if "bot_engine" in update:
                st.bot_engine = update["bot_engine"]
            if "bot_depth" in update:
                st.bot_depth = update["bot_depth"]
            if "maia_elo" in update:
                st.maia_elo = update["maia_elo"]
    except Exception:
        pass
    game = await db.games.find_one({"_id": oid})
    return _game_to_public(game)

# Section api/friends

friends_router = APIRouter(prefix="/friends", tags=["friends"])


# Checks whether last heartbeat counts as online
def _is_online(last_seen) -> bool:
    if not last_seen:
        return False
    try:
        now = datetime.now(timezone.utc)
        seen = last_seen
        if seen.tzinfo is None:
            seen = seen.replace(tzinfo=timezone.utc)
        return (now - seen).total_seconds() < 180
    except Exception:
        return False


# Expires stale pending challenges
async def _sweep_challenges(db):
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    except Exception:
        return
    try:
        await db.challenges.update_many(
            {"status": "pending", "created_at": {"$lt": cutoff}},
            {"$set": {"status": "expired"}},
        )
    except Exception:
        pass


# Sends friend request to user
@friends_router.post("/request", status_code=201)
async def send_friend_request(body: FriendRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])

    target = await db.users.find_one({"username": body.username})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    friend_id = str(target["_id"])

    if friend_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot friend yourself")

    reverse_pending = await db.friendships.find_one(
        {"user_id": friend_id, "friend_id": user_id, "status": "pending"}
    )
    if reverse_pending:
        await db.friendships.update_one(
            {"user_id": friend_id, "friend_id": user_id, "status": "pending"},
            {"$set": {"status": "accepted"}},
        )
        reverse = await db.friendships.find_one({"user_id": user_id, "friend_id": friend_id})
        if not reverse:
            reverse_doc = FriendshipDoc(user_id=user_id, friend_id=friend_id, status="accepted")
            await db.friendships.insert_one(reverse_doc.model_dump())
        return {"status": "accepted", "friend_id": friend_id}

    already = await db.friendships.find_one({
        "$or": [
            {"user_id": user_id, "friend_id": friend_id, "status": "accepted"},
            {"user_id": friend_id, "friend_id": user_id, "status": "accepted"},
        ]
    })
    if already:
        raise HTTPException(status_code=409, detail="Already friends")

    existing = await db.friendships.find_one({"user_id": user_id, "friend_id": friend_id})
    if existing:
        raise HTTPException(status_code=409, detail="Request already sent or friends already")

    friendship = FriendshipDoc(user_id=user_id, friend_id=friend_id)
    await db.friendships.insert_one(friendship.model_dump())
    return {"status": "requested", "friend_id": friend_id}

# Accepts pending friend request
@friends_router.post("/accept")
async def accept_friend_request(body: FriendRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])

    requester = await db.users.find_one({"username": body.username})
    if not requester:
        raise HTTPException(status_code=404, detail="User not found")
    requester_id = str(requester["_id"])

    result = await db.friendships.update_one(
        {"user_id": requester_id, "friend_id": user_id, "status": "pending"},
        {"$set": {"status": "accepted"}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="No pending request from this user")

    reverse = await db.friendships.find_one({"user_id": user_id, "friend_id": requester_id})
    if not reverse:
        reverse_doc = FriendshipDoc(user_id=user_id, friend_id=requester_id, status="accepted")
        await db.friendships.insert_one(reverse_doc.model_dump())

    return {"status": "accepted"}

# Declines pending friend request
@friends_router.post("/request/decline")
async def decline_friend_request(body: FriendRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])

    requester = await db.users.find_one({"username": body.username})
    if not requester:
        raise HTTPException(status_code=404, detail="User not found")

    result = await db.friendships.delete_one(
        {"user_id": str(requester["_id"]), "friend_id": user_id, "status": "pending"}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="No pending request from this user")
    return {"status": "declined"}

# Cancels outgoing friend request
@friends_router.delete("/request/{username}")
async def cancel_friend_request(username: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])

    target = await db.users.find_one({"username": username})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    result = await db.friendships.delete_one(
        {"user_id": user_id, "friend_id": str(target["_id"]), "status": "pending"}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="No outgoing request to this user")
    return {"status": "cancelled"}

# Lists friendships for current user
@friends_router.get("/")
async def list_friends(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])

    from bson import ObjectId

    # Accepted friends (outgoing accepted)
    accepted_friendships = await db.friendships.find(
        {"user_id": user_id, "status": "accepted"}
    ).to_list(100)

    friends = []
    for f in accepted_friendships:
        friend_doc = await db.users.find_one({"_id": ObjectId(f["friend_id"])})
        if friend_doc:
            friends.append({
                "user_id": f["user_id"],
                "friend_id": f["friend_id"],
                "username": friend_doc["username"],
                "status": "accepted",
                "is_online": _is_online(friend_doc.get("last_seen")),
            })

    # Pending incoming requests (someone sent a request to current user)
    incoming_pending = await db.friendships.find(
        {"friend_id": user_id, "status": "pending"}
    ).to_list(100)

    pending_requests = []
    for r in incoming_pending:
        requester_doc = await db.users.find_one({"_id": ObjectId(r["user_id"])})
        if requester_doc:
            pending_requests.append({
                "from_user": requester_doc["username"],
                "user_id": r["user_id"],
            })

    # Pending outgoing requests (current user is waiting on these users)
    outgoing_pending = await db.friendships.find(
        {"user_id": user_id, "status": "pending"}
    ).to_list(100)

    sent_requests = []
    for r in outgoing_pending:
        target_doc = await db.users.find_one({"_id": ObjectId(r["friend_id"])})
        if target_doc:
            sent_requests.append({"username": target_doc["username"]})

    return {"friends": friends, "pending_requests": pending_requests, "sent_requests": sent_requests}

# Removes friendship in both directions
@friends_router.delete("/{username}")
async def remove_friend(username: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])

    target = await db.users.find_one({"username": username})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    friend_id = str(target["_id"])

    await db.friendships.delete_many({
        "$or": [
            {"user_id": user_id, "friend_id": friend_id},
            {"user_id": friend_id, "friend_id": user_id},
        ]
    })
    return {"status": "removed"}

# Returns head-to-head record against friend
@friends_router.get("/{username}/record")
async def friend_record(username: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])

    target = await db.users.find_one({"username": username})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    friend_id = str(target["_id"])

    friendship = await db.friendships.find_one({
        "$or": [
            {"user_id": user_id, "friend_id": friend_id, "status": "accepted"},
            {"user_id": friend_id, "friend_id": user_id, "status": "accepted"},
        ]
    })
    if not friendship:
        raise HTTPException(status_code=403, detail="Not friends with this user")

    total = await db.games.count_documents({
        "$and": [
            {"$or": [{"white_id": user_id}, {"black_id": user_id}]},
            {"$or": [{"white_id": friend_id}, {"black_id": friend_id}]},
            {"result": {"$in": ["white", "black", "draw"]}},
        ]
    })

    cursor = db.games.find(
        {
            "$and": [
                {"$or": [{"white_id": user_id}, {"black_id": user_id}]},
                {"$or": [{"white_id": friend_id}, {"black_id": friend_id}]},
                {"result": {"$in": ["white", "black", "draw"]}},
            ]
        },
        {"white_id": 1, "black_id": 1, "result": 1, "mode": 1, "started_at": 1, "moves": 1},
    ).sort("started_at", -1).limit(50)
    recent_games = await cursor.to_list(50)

    def _mine(g):
        res = g.get("result")
        if res == "draw":
            return "draw"
        if (res == "white" and g.get("white_id") == user_id) or (
            res == "black" and g.get("black_id") == user_id
        ):
            return "win"
        return "loss"

    wins = draws = losses = 0
    all_cursor = db.games.find(
        {
            "$and": [
                {"$or": [{"white_id": user_id}, {"black_id": user_id}]},
                {"$or": [{"white_id": friend_id}, {"black_id": friend_id}]},
                {"result": {"$in": ["white", "black", "draw"]}},
            ]
        },
        {"white_id": 1, "black_id": 1, "result": 1},
    )
    async for g in all_cursor:
        r = _mine(g)
        if r == "win":
            wins += 1
        elif r == "draw":
            draws += 1
        else:
            losses += 1

    streak = {"type": None, "count": 0}
    for g in recent_games:
        r = _mine(g)
        if r == "draw":
            break
        if streak["type"] is None:
            streak = {"type": r, "count": 1}
        elif streak["type"] == r:
            streak["count"] += 1
        else:
            break

    form = [_mine(g) for g in list(reversed(recent_games[:5]))]

    last_played = None
    first_met = None
    if recent_games:
        last_played = _as_utc(recent_games[0].get("started_at"))
    oldest = await db.games.find(
        {
            "$and": [
                {"$or": [{"white_id": user_id}, {"black_id": user_id}]},
                {"$or": [{"white_id": friend_id}, {"black_id": friend_id}]},
                {"result": {"$in": ["white", "black", "draw"]}},
            ]
        },
        {"started_at": 1},
    ).sort("started_at", 1).limit(1).to_list(1)
    if oldest:
        first_met = _as_utc(oldest[0].get("started_at"))

    diff = wins - losses
    if total < 3:
        title = "New Rivalry"
    elif diff == 0:
        title = "Dead Even"
    elif diff >= 5:
        title = "Dominant"
    elif diff >= 2:
        title = "Ahead"
    elif diff <= -5:
        title = "Nemesis"
    elif diff <= -2:
        title = "Trailing"
    else:
        title = "Even Battle"

    milestones = []
    if total >= 50:
        milestones.append("50 battles")
    elif total >= 25:
        milestones.append("25 battles")
    elif total >= 10:
        milestones.append("10 battles")
    if streak["type"] == "win" and streak["count"] >= 3:
        milestones.append(f"{streak['count']}-game win streak")

    opener_counts = {}
    opener_games = 0
    for g in recent_games:
        mv = g.get("moves") or []
        if mv and mv[0].get("san"):
            opener_counts[mv[0]["san"]] = opener_counts.get(mv[0]["san"], 0) + 1
            opener_games += 1
    favorite_opener = None
    if opener_counts:
        top = max(opener_counts.items(), key=lambda kv: kv[1])
        favorite_opener = {"move": top[0], "times": top[1], "of_games": opener_games}

    recent = []
    for g in list(reversed(recent_games[:5])):
        recent.append({
            "id": str(g["_id"]),
            "mine": _mine(g),
            "result": g.get("result"),
            "mode": g.get("mode"),
            "started_at": _as_utc(g.get("started_at")),
        })

    played = wins + losses + draws
    return {
        "username": username,
        "matches": total,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "win_rate": round(wins / played * 100, 1) if played else 0.0,
        "streak": streak,
        "form": form,
        "title": title,
        "milestones": milestones,
        "last_played": last_played,
        "first_met": first_met,
        "favorite_opener": favorite_opener,
        "recent": recent,
    }

# Sends game challenge to friend
@friends_router.post("/challenge", status_code=201)
async def send_challenge(body: ChallengeRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])

    target = await db.users.find_one({"username": body.username})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    friend_id = str(target["_id"])
    if friend_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot challenge yourself")

    friendship = await db.friendships.find_one({
        "$or": [
            {"user_id": user_id, "friend_id": friend_id, "status": "accepted"},
            {"user_id": friend_id, "friend_id": user_id, "status": "accepted"},
        ]
    })
    if not friendship:
        raise HTTPException(status_code=403, detail="Not friends with this user")

    await _sweep_challenges(db)
    dup = await db.challenges.find_one({
        "$or": [
            {"from_id": user_id, "to_id": friend_id, "status": "pending"},
            {"from_id": friend_id, "to_id": user_id, "status": "pending"},
        ]
    })
    if dup:
        raise HTTPException(status_code=409, detail="A challenge is already pending between you")

    color_pref = getattr(body, "color_preference", "random") or "random"
    if color_pref not in ("white", "black", "random"):
        color_pref = "random"

    pgn_text = str(getattr(body, "pgn", "") or "").strip()
    is_imported = False
    fen_val = None
    moves_val = None
    turn_color = None
    moves_count = 0
    if pgn_text:
        moves_val, board_val, turn_color = _parse_pgn_moves(pgn_text)
        fen_val = board_val.fen()
        moves_count = len(moves_val)
        is_imported = True

    doc = {
        "from_id": user_id,
        "from_username": current_user["username"],
        "to_id": friend_id,
        "to_username": body.username,
        "time_control_seconds": body.time_control_seconds,
        "increment_seconds": body.increment_seconds,
        "color_preference": color_pref,
        "status": "pending",
        "game_id": None,
        "created_at": datetime.now(timezone.utc),
        "is_imported_pgn": is_imported,
        "pgn": pgn_text if is_imported else None,
        "fen": fen_val,
        "moves": moves_val,
        "turn_color": turn_color,
        "moves_count": moves_count,
    }
    res = await db.challenges.insert_one(doc)
    return {
        "status": "pending",
        "challenge_id": str(res.inserted_id),
        "is_imported_pgn": is_imported,
        "moves_count": moves_count,
    }

# Lists incoming pending challenges
@friends_router.get("/challenges/incoming")
async def incoming_challenges(current_user: dict = Depends(get_current_user)):
    db = get_db()
    await _sweep_challenges(db)
    cursor = db.challenges.find(
        {"to_id": str(current_user["_id"]), "status": "pending"}
    ).sort("created_at", -1).limit(50)
    docs = await cursor.to_list(50)
    return {"challenges": [
        {
            "id": str(d["_id"]),
            "from_username": d.get("from_username"),
            "time_control_seconds": d.get("time_control_seconds") if d.get("time_control_seconds") is not None else 600,
            "increment_seconds": d.get("increment_seconds", 0),
            "color_preference": d.get("color_preference", "random"),
            "status": d.get("status", "pending"),
            "is_imported_pgn": d.get("is_imported_pgn", False),
            "moves_count": d.get("moves_count", 0),
            "turn_color": d.get("turn_color"),
            "created_at": _as_utc(d.get("created_at")),
        }
        for d in docs
    ]}

# Lists outgoing pending challenges
@friends_router.get("/challenges/outgoing")
async def outgoing_challenges(current_user: dict = Depends(get_current_user)):
    db = get_db()
    await _sweep_challenges(db)
    cursor = db.challenges.find(
        {"from_id": str(current_user["_id"]), "status": {"$in": ["pending", "accepted"]}}
    ).sort("created_at", -1).limit(50)
    docs = await cursor.to_list(50)
    return {"challenges": [
        {
            "id": str(d["_id"]),
            "to_username": d.get("to_username"),
            "time_control_seconds": d.get("time_control_seconds") if d.get("time_control_seconds") is not None else 600,
            "increment_seconds": d.get("increment_seconds", 0),
            "color_preference": d.get("color_preference", "random"),
            "status": d.get("status", "pending"),
            "game_id": d.get("game_id"),
            "is_imported_pgn": d.get("is_imported_pgn", False),
            "moves_count": d.get("moves_count", 0),
            "turn_color": d.get("turn_color"),
            "created_at": _as_utc(d.get("created_at")),
        }
        for d in docs
    ]}

# Accepts challenge and creates game
@friends_router.post("/challenges/{challenge_id}/accept")
async def accept_challenge(challenge_id: str, current_user: dict = Depends(get_current_user)):
    import random
    from bson import ObjectId as _OID
    try:
        oid = _OID(challenge_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Challenge not found")
    db = get_db()
    user_id = str(current_user["_id"])

    await _sweep_challenges(db)
    doc = await db.challenges.find_one({"_id": oid})
    if not doc or doc.get("to_id") != user_id or doc.get("status") != "pending":
        raise HTTPException(status_code=404, detail="Challenge not available")

    color_pref = doc.get("color_preference", "random")
    if color_pref == "white":
        white_id = doc["from_id"]
        black_id = user_id
    elif color_pref == "black":
        white_id = user_id
        black_id = doc["from_id"]
    else:
        if random.random() < 0.5:
            white_id = doc["from_id"]
            black_id = user_id
        else:
            white_id = user_id
            black_id = doc["from_id"]

    tc_val = doc.get("time_control_seconds")
    tc_sec = 600 if tc_val is None else tc_val

    game_dict = {
        "white_id": white_id,
        "black_id": black_id,
        "mode": "friend",
        "bot_engine": None,
        "bot_level": None,
        "bot_depth": None,
        "maia_elo": None,
        "player_color": None,
        "training_mode": False,
        "result": "ongoing",
        "started_at": datetime.now(timezone.utc),
        "ended_at": None,
        "time_control_seconds": tc_sec,
        "increment_seconds": doc.get("increment_seconds", 0),
    }
    if doc.get("is_imported_pgn") and doc.get("moves"):
        game_dict["fen"] = doc.get("fen")
        game_dict["moves"] = doc.get("moves")

    res = await db.games.insert_one(game_dict)
    game_id = str(res.inserted_id)
    game_dict["_id"] = res.inserted_id

    if doc.get("is_imported_pgn") and doc.get("moves"):
        from realtime import GameState, _set_state
        state = GameState(game_dict)
        _set_state(game_id, state)

    await db.challenges.update_one(
        {"_id": oid},
        {"$set": {"status": "accepted", "game_id": game_id}},
    )
    return {"status": "accepted", "game_id": game_id}

# Declines incoming challenge
@friends_router.post("/challenges/{challenge_id}/decline")
async def decline_challenge(challenge_id: str, current_user: dict = Depends(get_current_user)):
    from bson import ObjectId as _OID
    try:
        oid = _OID(challenge_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Challenge not found")
    db = get_db()

    result = await db.challenges.update_one(
        {"_id": oid, "to_id": str(current_user["_id"]), "status": "pending"},
        {"$set": {"status": "declined"}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Challenge not available")
    return {"status": "declined"}

# Cancels outgoing challenge
@friends_router.delete("/challenges/{challenge_id}")
async def cancel_challenge(challenge_id: str, current_user: dict = Depends(get_current_user)):
    from bson import ObjectId as _OID
    try:
        oid = _OID(challenge_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Challenge not found")
    db = get_db()

    result = await db.challenges.update_one(
        {"_id": oid, "from_id": str(current_user["_id"]), "status": "pending"},
        {"$set": {"status": "cancelled"}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Challenge not available")
    return {"status": "cancelled"}

# Returns notification counts for inbox badge
@friends_router.get("/notifications/counts")
async def notification_counts(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = str(current_user["_id"])
    await _sweep_challenges(db)
    friend_requests = await db.friendships.count_documents(
        {"friend_id": user_id, "status": "pending"}
    )
    challenge_requests = await db.challenges.count_documents(
        {"to_id": user_id, "status": "pending"}
    )
    return {"friend_requests": friend_requests, "challenge_requests": challenge_requests}

# Section api/analysis

analysis_router = APIRouter(prefix="/analysis", tags=["analysis"])


# Defines position analysis request schema
class AnalyzeRequest(BaseModel):
    fen: str
    multipv: int = 3

# Analyzes board position on demand
@analysis_router.post("/", response_model=AnalysisResult)
async def analyze(body: AnalyzeRequest, current_user: dict = Depends(get_current_user)):
    result = await analyze_position(body.fen, multipv=body.multipv)
    return result

# Section api/coach

logger = logging.getLogger(__name__)


coach_router = APIRouter(prefix="/coach", tags=["coach"])


_coach_engine = AsyncEngineProxy()


_gm_matcher = None


_gm_matcher_lock = None


_gm_matcher_warming = False


_gm_load_error: Optional[str] = None


_CHALLENGE_INDEX: dict[str, list[dict]] = {}


# Loads GM model asynchronously from registry
async def _aget_gm_model(model_id: Optional[str] = None, is_admin: bool = False):
    global _gm_load_error
    if GMPolicyValueNet is None:
        _gm_load_error = "torch not installed in this environment (GMPolicyValueNet is None)"
        return None, None
    doc = await gm_get_model_doc(model_id, include_unpublished=is_admin)
    if model_id and not doc:
        raise HTTPException(status_code=404 if is_admin else 403,
                            detail="GM model not found" if is_admin else "That GM model is not published yet.")
    if not doc:
        _gm_load_error = "no published GM model yet — train one in The Forge"
        return None, None
    model = gm_load_gm_model(doc["checkpoint_path"], doc.get("config"))
    if model is None:
        _gm_load_error = gm_load_error_of(doc["checkpoint_path"]) or "model failed to load"
        return None, doc
    _gm_load_error = None
    return model, doc

# Provides fallback GM-style move without torch
async def _fallback_gm_move(board, top_k: int):
    import chess
    legal = list(board.legal_moves)
    if not legal:
        return {"top_gm_moves": [], "gm_best_san": "None", "gm_best_uci": None,
                "confidence": 0.0, "position_value": 0.0,
                "source": "fallback-empty", "model": "none"}
    try:
        top = await _coach_engine.get_top_moves(board.fen(), count=min(top_k, len(legal)), depth=12)
        if top:
            moves = []
            for i, t in enumerate(top[:top_k]):
                conf = round(max(5.0, 85.0 - float(t.get("cp_delta", i * 30))), 1)
                moves.append({
                    "move_san": t["move_san"],
                    "move_uci": t["move_uci"],
                    "prob": round(max(0.05, 0.7 - i * 0.2), 3),
                    "confidence_pct": conf,
                })
            return {
                "top_gm_moves": moves,
                "gm_best_san": moves[0]["move_san"],
                "gm_best_uci": moves[0]["move_uci"],
                "confidence": moves[0]["confidence_pct"],
                "position_value": round(float(top[0].get("score_white", 0.0)), 2),
                "source": "fallback-stockfish",
                "model": "stockfish-depth12",
            }
    except Exception as e:
        logger.warning(f"[coach] Stockfish fallback failed, using heuristic: {e}")
    # Scores move for heuristic ranking
    def _score(m: chess.Move) -> tuple:
        cap = 1 if board.is_capture(m) else 0
        to = m.to_square
        f, r = chess.square_file(to), chess.square_rank(to)
        centrality = -(abs(3.5 - f) + abs(3.5 - r))
        promo = 1 if m.promotion else 0
        return (promo, cap, centrality)
    ranked_moves = sorted(legal, key=_score, reverse=True)[:top_k]
    moves = [{
        "move_san": board.san(m),
        "move_uci": m.uci(),
        "prob": round(1.0 / len(ranked_moves), 3),
        "confidence_pct": round(max(10.0, 60.0 - i * 10.0), 1),
    } for i, m in enumerate(ranked_moves)]
    return {
        "top_gm_moves": moves,
        "gm_best_san": moves[0]["move_san"],
        "gm_best_uci": moves[0]["move_uci"],
        "confidence": moves[0]["confidence_pct"],
        "position_value": 0.0,
        "source": "fallback-heuristic",
        "model": "heuristic",
    }

# Returns singleton GM game matcher
def _get_gm_matcher():
    global _gm_matcher, _gm_matcher_lock
    if _gm_matcher is not None:
        return _gm_matcher
    import threading
    if _gm_matcher_lock is None:
        _gm_matcher_lock = threading.Lock()
    with _gm_matcher_lock:
        if _gm_matcher is None:
            try:
                _gm_matcher = GMHistoricalMatcher()
            except Exception as e:
                logger.error(f"[coach] Failed to init GM matcher: {e}")
    return _gm_matcher

# Warms GM matcher index in background
def _ensure_gm_matcher_warm():
    global _gm_matcher_warming
    if _gm_matcher is not None or _gm_matcher_warming:
        return
    _gm_matcher_warming = True

    # Triggers matcher warmup task
    def _warm():
        global _gm_matcher_warming
        try:
            _get_gm_matcher()
        except Exception:
            pass
        finally:
            _gm_matcher_warming = False

    import threading
    threading.Thread(target=_warm, name="gm-matcher-warm", daemon=True).start()

# Defines hint request schema
class HintRequest(BaseModel):
    fen: str
    depth: int = 12

# Defines move explanation request schema
class MoveExplainRequest(BaseModel):
    fen: str
    player_move_uci: str
    best_move_uci: Optional[str] = None
    cp_loss: float = 0.0
    classification: Optional[dict] = None

# Defines position request schema
class PositionRequest(BaseModel):
    fen: str

# Defines simulation request schema
class SimulateRequest(BaseModel):
    fen: str
    move: Optional[str] = None
    n_moves: int = 5
    depth: int = 12
    user_color: str = "white"

# Defines candidate moves request schema
class CandidatesRequest(BaseModel):
    fen: str
    count: int = 10
    depth: int = 12

# Defines GM move request schema
class GMMoveRequest(BaseModel):
    fen: str
    top_k: int = 3
    model_id: Optional[str] = None

# Defines lesson request schema
class LessonRequest(BaseModel):
    player_move: str
    stockfish_move: str
    cp_loss: float
    classification: dict

# Returns progressive hints for position
@coach_router.post("/hint")
async def get_hint(req: HintRequest):
    try:
        result = await HintSystem.get_progressive_hints(req.fen, stockfish=_coach_engine, depth=req.depth)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Explains move with strategic defect analysis
@coach_router.post("/explain")
async def explain_move(req: MoveExplainRequest):
    try:
        best_uci = req.best_move_uci
        if not best_uci:
            best_uci = await _coach_engine.best_move(req.fen, depth=15)

        classification = req.classification
        if not classification:
            classification = EvaluationAnalyzer.classify(req.cp_loss)

        result = await MoveExplainer.explain(
            fen=req.fen,
            player_move_uci=req.player_move_uci,
            best_move_uci=best_uci,
            cp_loss=req.cp_loss,
            classification=classification,
            stockfish=_coach_engine,
        )
        try:
            import chess as _ch
            from intelligence import explain_move_rich
            _b = _ch.Board(req.fen)
            try:
                _san = _b.san(_ch.Move.from_uci(req.player_move_uci))
            except Exception:
                _san = req.player_move_uci
            try:
                _best_san = _b.san(_ch.Move.from_uci(best_uci)) if best_uci else _san
            except Exception:
                _best_san = best_uci or _san
            _thing1 = (result.get("thing_1") or {})
            _thing2 = (result.get("thing_2") or {})
            result["narrative"] = await explain_move_rich(
                fen=req.fen, player_move_san=_san, best_move_san=_best_san,
                classification=(classification or {}).get("label", "Good") if isinstance(classification, dict) else str(classification),
                cp_loss=req.cp_loss,
                advantages=_thing1.get("strengths") or ([_thing1.get("summary")] if _thing1.get("summary") else []),
                disadvantages=_thing2.get("defects") or ([_thing2.get("summary")] if _thing2.get("summary") else []),
            )
        except Exception as e:
            logger.info(f"[coach] narrative skipped: {e}")
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Evaluates position across 11 dimensions
@coach_router.post("/position")
async def analyze_coach_position(req: PositionRequest):
    try:
        result = PositionalEvaluator.evaluate(req.fen)
        try:
            from api import _position_pros_cons
            result["pros_cons"] = _position_pros_cons(result.get("parameters"))
        except Exception:
            pass
        try:
            import chess as _ch2
            from intelligence import explain_position_rich
            _b2 = _ch2.Board(req.fen)
            result["narrative"] = await explain_position_rich(
                fen=req.fen, verdict=result.get("verdict", ""),
                parameters=result.get("parameters"),
                turn="white" if _b2.turn == _ch2.WHITE else "black")
        except Exception as e:
            logger.info(f"[coach] position narrative skipped: {e}")
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Simulates future continuation with analysis
@coach_router.post("/simulate")
async def simulate_future(req: SimulateRequest):
    try:
        result = await FutureSimulator.simulate(
            stockfish=_coach_engine,
            fen=req.fen,
            move_str=req.move,
            n_moves=req.n_moves,
            depth=req.depth,
            user_color=req.user_color,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Returns ranked Stockfish candidate moves
@coach_router.post("/candidates")
async def ranked_candidates(req: CandidatesRequest):
    import chess
    try:
        board = chess.Board(req.fen)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid FEN.")
    legal = list(board.legal_moves)
    if board.is_game_over() or not legal:
        return {"fen": req.fen, "count": 0, "total_legal": 0, "candidates": []}
    count = max(1, min(int(req.count or 10), 20, len(legal)))
    depth = max(4, min(int(req.depth or 12), 22))
    try:
        top = await _coach_engine.get_top_moves(req.fen, count=count, depth=depth)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    from engines import eval_to_win_prob
    candidates = []
    for t in top:
        try:
            b2 = board.copy()
            b2.push(chess.Move.from_uci(t["move_uci"]))
            fen_after = b2.fen()
        except Exception:
            fen_after = req.fen
        score_white_cp = int(round(float(t.get("score_white", 0.0)) * 100.0))
        candidates.append({
            **t,
            "win_prob": round(eval_to_win_prob(score_white_cp), 4),
            "fen_after": fen_after,
        })
    return {
        "fen": req.fen,
        "count": len(candidates),
        "total_legal": len(legal),
        "candidates": candidates,
    }

# Detects tactical motifs on board
@coach_router.post("/motifs")
async def detect_motifs(req: PositionRequest):
    try:
        import chess
        board = chess.Board(req.fen)
        motifs = TacticalMotifDetector.detect_motifs(board)
        return {"motifs": motifs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Returns strategic concepts for move
@coach_router.post("/concepts")
async def get_move_concepts(req: MoveExplainRequest):
    try:
        import chess
        board = chess.Board(req.fen)
        move_obj = chess.Move.from_uci(req.player_move_uci) if req.player_move_uci else None
        result = get_concepts(
            move=req.player_move_uci,
            board=board if move_obj else None,
            move_obj=move_obj,
            best_move_uci=req.best_move_uci,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Reports health of GM move stack
@coach_router.get("/gm-health")
async def gm_health():
    _ensure_gm_matcher_warm()
    models = await gm_list_models(include_unpublished=True)
    published = [m for m in models if m.get("published")]
    return {
        "torch_available": GMPolicyValueNet is not None,
        "models_total": len(models),
        "models_published": len(published),
        "active_model": published[0] if published else None,
        "load_error": _gm_load_error,
        "matcher_ready": _gm_matcher is not None,
        "matcher_warming": _gm_matcher_warming,
    }

# Predicts grandmaster move for position
@coach_router.post("/gm-move")
async def gm_move_prediction(req: GMMoveRequest):
    try:
        import chess
        try:
            board = chess.Board(req.fen)
        except Exception:
            raise HTTPException(status_code=422, detail="Invalid FEN.")
        top_k = max(1, min(int(req.top_k or 3), 10))
        if board.is_game_over() or not list(board.legal_moves):
            return {"top_gm_moves": [], "gm_best_san": "None", "gm_best_uci": None,
                    "confidence": 0.0, "position_value": 0.0,
                    "source": "game-over", "model": "none"}

        model, doc = await _aget_gm_model(req.model_id, is_admin=False)
        if model is not None:
            try:
                result = model.predict_gm_move(board, top_k=top_k)
                for m in result.get("top_gm_moves", []):
                    m.pop("move_obj", None)
                if doc is not None:
                    result["model_id"] = doc.get("model_id")
                return result
            except Exception as e:
                logger.exception(f"[coach] ResNet inference failed, using fallback: {e}")

        result = await _fallback_gm_move(board, top_k)
        if not result.get("top_gm_moves"):
            raise HTTPException(status_code=503, detail="No legal GM moves available.")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[coach] gm-move failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Matches position against GM game database
@coach_router.post("/gm-match")
async def gm_historical_match(req: PositionRequest):
    try:
        matcher = _get_gm_matcher()
        if matcher is None:
            raise HTTPException(status_code=503, detail="GM historical matcher not available.")
        result = matcher.match_position(req.fen)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Generates lesson from move classification
@coach_router.post("/lesson")
async def generate_lesson(req: LessonRequest):
    try:
        result = LessonGenerator.generate(
            player_move=req.player_move,
            stockfish_move=req.stockfish_move,
            cp_loss=req.cp_loss,
            classification=req.classification,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Checks whether user has admin role
def _is_admin_user(user: dict) -> bool:
    return bool(user) and user.get("role") == "admin"

# Loads challenge model document for user
async def _challenge_model_doc(model_id: Optional[str], user: dict) -> dict:
    doc = await gm_get_model_doc(model_id, include_unpublished=_is_admin_user(user))
    if doc is None:
        if model_id:
            raise HTTPException(status_code=404 if _is_admin_user(user) else 403,
                                detail="GM model not found." if _is_admin_user(user)
                                else "That GM model is not published yet.")
        raise HTTPException(status_code=404,
                            detail="locked: no published GM model yet — train one in The Forge first.")
    return doc

# Returns training PGN text for challenge
async def _challenge_pgn_text(doc: dict) -> str:
    grid_id = doc.get("pgn_gridfs_id")
    if grid_id:
        try:
            return await pgn_get_text(grid_id)
        except Exception as e:
            logger.warning(f"[coach] gridfs PGN missing for model {doc.get('model_id')}: {e}")
    pgn = doc.get("pgn_path")
    if pgn:
        import os as _os
        if _os.path.exists(pgn):
            return Path(pgn).read_text(encoding="utf-8", errors="replace")
    from gm import DEFAULT_GM_PGN
    if DEFAULT_GM_PGN.exists():
        return DEFAULT_GM_PGN.read_text(encoding="utf-8", errors="replace")
    return ""

# Builds cache key for challenge index
def _challenge_cache_key(doc: dict) -> str:
    return doc.get("pgn_gridfs_id") or doc.get("pgn_path") or "bundled"

# Builds middlegame index from PGN text
def _build_challenge_index(cache_key: str, pgn_text: str) -> list[dict]:
    import chess
    import chess.pgn
    import io as _io
    cached = _CHALLENGE_INDEX.get(cache_key)
    if cached:
        return cached
    positions: list[dict] = []
    try:
        fh = _io.StringIO(pgn_text)
        games = 0
        while games < 1000 and len(positions) < 3000:
                try:
                    game = chess.pgn.read_game(fh)
                except Exception:
                    break
                if game is None:
                    break
                games += 1
                headers = {k: str(v) for k, v in (game.headers or {}).items()}
                board = game.board()
                ply = 0
                for move in game.mainline_moves():
                    try:
                        board.push(move)
                    except Exception:
                        break
                    ply += 1
                    if ply < 16 or ply > 80:
                        continue
                    if board.is_game_over():
                        continue
                    try:
                        legal_count = sum(1 for _ in board.legal_moves)
                    except Exception:
                        continue
                    if legal_count <= 2:
                        continue
                    positions.append({
                        "fen": board.fen(),
                        "ply": ply,
                        "turn": "white" if board.turn == chess.WHITE else "black",
                        "white": headers.get("White", "?"),
                        "black": headers.get("Black", "?"),
                        "result": headers.get("Result", "*"),
                        "event": headers.get("Event", ""),
                    })
    except Exception as e:
        logger.warning(f"[coach] challenge index failed for {cache_key}: {e}")
    if positions:
        _CHALLENGE_INDEX[cache_key] = positions
    return positions

# Computes legal-move probability distribution
def _gm_full_distribution(model, board) -> list[dict]:
    import numpy as np
    import torch
    from gm import board_to_tensor, move_to_action
    model.eval()
    tensor = torch.tensor(board_to_tensor(board), dtype=torch.float32).unsqueeze(0)
    with torch.no_grad():
        logits, value = model.forward(tensor)
        logits = logits[0].cpu().numpy()
        pos_val = float(value[0].item())
    legal = list(board.legal_moves)
    scores = np.array([logits[move_to_action(m)] for m in legal], dtype=np.float64)
    exp = np.exp(scores - np.max(scores))
    probs = exp / np.sum(exp)
    ranked = [{
        "move_san": board.san(m),
        "move_uci": m.uci(),
        "prob": float(probs[i]),
        "confidence_pct": round(float(probs[i]) * 100.0, 1),
    } for i, m in enumerate(legal)]
    ranked.sort(key=lambda r: r["prob"], reverse=True)
    return ranked, pos_val

# Labels position from pawn score
def _position_label(score_white_pawns: float) -> str:
    a = abs(score_white_pawns)
    if a < 0.4:
        return "Equal — anyone's game."
    if a < 1.2:
        side = "White" if score_white_pawns > 0 else "Black"
        return f"Slight edge for {side}."
    if a < 3.0:
        side = "White" if score_white_pawns > 0 else "Black"
        return f"Clearly better for {side}."
    side = "White" if score_white_pawns > 0 else "Black"
    return f"{side} is winning."

# Lists models visible to caller
@coach_router.get("/gm-models")
async def gm_models_list(current_user: dict = Depends(get_current_user)):
    models = await gm_list_models(include_unpublished=_is_admin_user(current_user))
    return {"models": models, "count": len(models),
            "is_admin": _is_admin_user(current_user)}

# Draws random GM middlegame challenge position
@coach_router.get("/gm-challenge")
async def gm_challenge(model_id: Optional[str] = None,
                       current_user: dict = Depends(get_current_user)):
    import chess
    doc = await _challenge_model_doc(model_id, current_user)
    pgn_text = await _challenge_pgn_text(doc)
    if not pgn_text.strip():
        raise HTTPException(status_code=503, detail="No GM game collection available.")
    positions = _build_challenge_index(_challenge_cache_key(doc), pgn_text)
    if not positions:
        raise HTTPException(status_code=503, detail="Could not build challenge positions from the PGN data.")
    try:
        await _aget_gm_model(doc.get("model_id"), is_admin=_is_admin_user(current_user))
    except Exception:
        pass
    pick = random.choice(positions)
    try:
        legal = [m.uci() for m in chess.Board(pick["fen"]).legal_moves]
    except Exception:
        raise HTTPException(status_code=503, detail="Sampled an invalid position, try again.")
    return {
        "fen": pick["fen"],
        "turn": pick["turn"],
        "ply": pick["ply"],
        "legal_moves": legal,
        "game": {"white": pick["white"], "black": pick["black"],
                 "result": pick["result"], "event": pick["event"]},
        "model_id": doc.get("model_id"),
        "model_name": doc.get("name"),
    }

# Defines GM challenge scoring request schema
class GMScoreRequest(BaseModel):
    fen: str
    user_move_uci: str
    model_id: Optional[str] = None

# Scores player move against GM brain
@coach_router.post("/gm-challenge/score")
async def gm_challenge_score(req: GMScoreRequest,
                             current_user: dict = Depends(get_current_user)):
    import chess
    doc = await _challenge_model_doc(req.model_id, current_user)
    try:
        board = chess.Board(req.fen)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid FEN.")
    try:
        user_move = chess.Move.from_uci(req.user_move_uci)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid move.")
    if user_move not in board.legal_moves:
        raise HTTPException(status_code=422, detail="That move is not legal in this position.")
    if board.is_game_over():
        raise HTTPException(status_code=422, detail="The game is already over in this position.")

    model, _ = await _aget_gm_model(doc.get("model_id"), is_admin=_is_admin_user(current_user))
    if model is None:
        raise HTTPException(status_code=503, detail="GM model failed to load — check The Forge.")
    ranked, pos_val = _gm_full_distribution(model, board)
    top3 = ranked[:3]

    user_idx = next((i for i, r in enumerate(ranked) if r["move_uci"] == user_move.uci()), None)
    user_entry = ranked[user_idx] if user_idx is not None else None
    user_prob_pct = round((user_entry["prob"] * 100.0), 1) if user_entry else 0.0

    if user_idx == 0:
        score, tier, headline = 100.0, "gm-instinct", "Pure GM Instinct!"
    elif user_idx == 1:
        score, tier, headline = 82.0, "grandmaster", "Grandmaster Thinking!"
    elif user_idx == 2:
        score, tier, headline = 72.0, "grandmaster", "Grandmaster Thinking!"
    else:
        score, tier = user_prob_pct, "off-book"
        headline = (f"A GM would've played {top3[0]['move_san']} "
                    f"instead ({top3[0]['confidence_pct']}% confidence)")

    eval_white = 0.0
    try:
        eval_white = round(float(await _coach_engine.evaluate(req.fen, depth=12)), 2)
    except Exception:
        pass

    return {
        "score_pct": score,
        "tier": tier,
        "headline": headline,
        "user_move_san": board.san(user_move),
        "user_move_uci": user_move.uci(),
        "user_prob_pct": user_prob_pct,
        "top_moves": top3,
        "gm_best_san": top3[0]["move_san"],
        "gm_best_uci": top3[0]["move_uci"],
        "gm_confidence": top3[0]["confidence_pct"],
        "position_value": round(pos_val, 2),
        "eval_white": eval_white,
        "position_label": _position_label(eval_white),
        "model_id": doc.get("model_id"),
    }

# Section api/report

logger = logging.getLogger(__name__)


report_router = APIRouter(prefix="/report", tags=["report"])


_report_engine = AsyncEngineProxy()


# Defines game analysis request schema
class AnalyzeGameRequest(BaseModel):
    pgn_text: Optional[str] = None
    pgn_path: Optional[str] = None

# Defines full report request schema
class FullReportRequest(BaseModel):
    pgn_text: Optional[str] = None
    pgn_path: Optional[str] = None

# Analyzes every move in game
@report_router.post("/analyze-game")
async def analyze_game(req: AnalyzeGameRequest):
    try:
        if req.pgn_text:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".pgn", delete=False, encoding="utf-8") as f:
                f.write(req.pgn_text)
                temp_path = f.name
            try:
                results = await GameAnalyzer.analyze_game(_report_engine, temp_path)
            finally:
                os.unlink(temp_path)
        elif req.pgn_path:
            results = await GameAnalyzer.analyze_game(_report_engine, req.pgn_path)
        else:
            raise HTTPException(status_code=400, detail="Provide pgn_text or pgn_path.")

        return {"moves": results, "total_moves": len(results)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Analyzes PGN text or path into move results
async def _analyze_report_moves(pgn_text, pgn_path):
    if pgn_text:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".pgn", delete=False, encoding="utf-8") as f:
            f.write(pgn_text)
            temp_path = f.name
        try:
            return await GameAnalyzer.analyze_game(_report_engine, temp_path)
        finally:
            try:
                os.unlink(temp_path)
            except Exception:
                pass
    if pgn_path:
        return await GameAnalyzer.analyze_game(_report_engine, pgn_path)
    raise HTTPException(status_code=400, detail="Provide pgn_text or pgn_path.")


# Builds shared report payload from move results
def _build_report_payload(move_results, pgn_text=None, pgn_path=None):
    report_summary = GameReport.summarize(move_results)
    accuracy = GameReport.accuracy_score(move_results)
    acc_white = GameReport.color_accuracy(move_results, "white")
    acc_black = GameReport.color_accuracy(move_results, "black")
    from review import grade_for as _gf
    grade = GameReport.grade(accuracy)
    weaknesses = WeaknessDetector.detect(move_results)
    style = StyleAnalyzer.analyze(move_results)
    training_plan = TrainingPlan.generate(weaknesses["weaknesses"])
    opening_recs = OpeningRecommender.recommend(style["style"])
    opening = OpeningDetector.detect(pgn_path) if pgn_path else OpeningDetector.detect_text(pgn_text or "")
    summary_text = GameSummary.generate({
        "blunders": weaknesses["blunders"],
        "mistakes": weaknesses["mistakes"],
        "inaccuracies": weaknesses["inaccuracies"],
        "weaknesses": weaknesses["weaknesses"],
    })
    return {
        "opening": opening,
        "accuracy": accuracy,
        "accuracy_white": acc_white,
        "accuracy_black": acc_black,
        "grade": grade,
        "grade_white": _gf(acc_white),
        "grade_black": _gf(acc_black),
        "style": style["style"],
        "style_scores": style["scores"],
        "weaknesses": weaknesses["weaknesses"],
        "summary_counts": report_summary,
        "training_plan": training_plan,
        "opening_recommendations": opening_recs,
        "summary_text": summary_text,
        "moves": [
            {
                "move_number": m["move_number"],
                "fullmove_number": m.get("fullmove_number", m["move_number"]),
                "ply": m.get("ply"),
                "turn": m.get("turn"),
                "move": m["san"],
                "san": m["san"],
                "best_move": m.get("best_move"),
                "best_move_san": m.get("best_move_san"),
                "classification": m["classification"],
                "cp_loss": m["cp_loss"],
                "accuracy_score": m.get("accuracy_score", 100.0),
                "concepts": m.get("concepts", []),
            }
            for m in move_results
        ],
    }


# Generates complete game report with plan
@report_router.post("/full-report")
async def generate_full_report(req: FullReportRequest):
    try:
        move_results = await _analyze_report_moves(req.pgn_text, req.pgn_path)
        if not move_results:
            raise HTTPException(status_code=400, detail="No moves found in game.")
        return _build_report_payload(move_results, req.pgn_text, req.pgn_path)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Generates downloadable PDF game report
@report_router.post("/pdf")
async def generate_pdf(req: FullReportRequest):
    from starlette.background import BackgroundTask as _BT
    try:
        move_results = await _analyze_report_moves(req.pgn_text, req.pgn_path)
        if not move_results:
            raise HTTPException(status_code=400, detail="No moves found.")
        report_data = _build_report_payload(move_results, req.pgn_text, req.pgn_path)
        fd, pdf_path = tempfile.mkstemp(prefix="rightmove_report_", suffix=".pdf")
        os.close(fd)

        def _cleanup(path: str):
            try:
                os.unlink(path)
            except Exception:
                pass

        PDFReport.generate(pdf_path, report_data)
        return FileResponse(
            path=pdf_path,
            filename="rightmove_coach_report.pdf",
            media_type="application/pdf",
            background=_BT(_cleanup, pdf_path),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Section api/learn

logger = logging.getLogger(__name__)


learn_router = APIRouter(prefix="/learn", tags=["learn"])


_learn_engine = AsyncEngineProxy()


MAX_GAMES = 20


MAX_PLIES_PER_GAME = 200


EVAL_DEPTH = 12


# Evaluates position centipawn score
async def _eval_cp(fen: str) -> int:
    try:
        v = await _learn_engine.evaluate(fen, depth=EVAL_DEPTH)
        return int(round(float(v) * 100.0))
    except Exception:
        return 0

# Classifies move from centipawn loss
def _classify(cp_loss: int) -> str:
    if cp_loss <= 20:
        return "Best Move"
    if cp_loss <= 50:
        return "Excellent"
    if cp_loss <= 100:
        return "Good"
    if cp_loss <= 200:
        return "Inaccuracy"
    if cp_loss <= 400:
        return "Mistake"
    return "Blunder"

# Derives move advantages from mover perspective
def _move_pros_cons(params_before: dict | None, params_after: dict | None,
                    side: str, cp_loss: int, classification: str) -> dict:
    advantages: list[str] = []
    disadvantages: list[str] = []
    try:
        if params_before and params_after:
            mover_white = side == "white"
            for key, after in (params_after or {}).items():
                before = (params_before or {}).get(key)
                if not before or not isinstance(after, dict):
                    continue
                try:
                    d_before = float(before.get("diff", 0))
                    d_after = float(after.get("diff", 0))
                except Exception:
                    continue
                swing = d_after - d_before
                if not mover_white:
                    swing = -swing
                name = after.get("name", key)
                if swing >= 25:
                    advantages.append(f"{name}: improved by +{swing:.0f} — strengthened your position.")
                elif swing >= 12:
                    advantages.append(f"{name}: slightly improved (+{swing:.0f}).")
                elif swing <= -25:
                    disadvantages.append(f"{name}: worsened by {swing:.0f} — gave the opponent room.")
                elif swing <= -12:
                    disadvantages.append(f"{name}: slightly worsened ({swing:.0f}).")
    except Exception:
        pass
    try:
        if cp_loss <= 20:
            advantages.append("Kept (or improved) the engine evaluation — no advantage conceded.")
        elif cp_loss <= 100:
            disadvantages.append(f"Conceded a small edge ({cp_loss:.0f} cp) versus the engine's best plan.")
        elif cp_loss <= 300:
            disadvantages.append(f"Gave away the initiative ({cp_loss:.0f} cp) — opponent can press now.")
        else:
            disadvantages.append(f"Serious deterioration ({cp_loss:.0f} cp) — likely changed who stands better.")
    except Exception:
        pass
    if not advantages:
        advantages.append("No clear positional gain from this move.")
    if not disadvantages:
        disadvantages.append("No clear positional harm from this move.")
    return {"advantages": advantages[:6], "disadvantages": disadvantages[:6],
            "summary": f"{classification}: " + (advantages[0] if cp_loss <= 100 else disadvantages[0])}

# Splits position advantages by side
def _position_pros_cons(parameters: dict | None) -> dict:
    adv_w: list[str] = []
    dis_w: list[str] = []
    try:
        for key, p in (parameters or {}).items():
            if not isinstance(p, dict):
                continue
            try:
                d = float(p.get("diff", 0))
            except Exception:
                continue
            name = p.get("name", key)
            if d >= 40:
                adv_w.append(f"{name} clearly favors White (+{d:.0f}).")
            elif d >= 15:
                adv_w.append(f"{name} slightly favors White (+{d:.0f}).")
            elif d <= -40:
                dis_w.append(f"{name} clearly favors Black ({d:.0f}).")
            elif d <= -15:
                dis_w.append(f"{name} slightly favors Black ({d:.0f}).")
    except Exception:
        pass
    adv_b = []
    dis_b = []
    try:
        for key, p in (parameters or {}).items():
            if not isinstance(p, dict):
                continue
            d = float(p.get("diff", 0))
            name = p.get("name", key)
            if d <= -40:
                adv_b.append(f"{name} clearly favors Black ({abs(d):.0f}).")
            elif d <= -15:
                adv_b.append(f"{name} slightly favors Black ({abs(d):.0f}).")
            elif d >= 40:
                dis_b.append(f"{name} clearly favors White (+{d:.0f}).")
            elif d >= 15:
                dis_b.append(f"{name} slightly favors White (+{d:.0f}).")
    except Exception:
        pass
    if not adv_w:
        adv_w.append("No standout edge for White — position is balanced here.")
    if not dis_w:
        dis_w.append("No major weakness for White in the measured parameters.")
    if not adv_b:
        adv_b.append("No standout edge for Black — position is balanced here.")
    if not dis_b:
        dis_b.append("No major weakness for Black in the measured parameters.")
    return {"white": {"advantages": adv_w[:6], "disadvantages": dis_w[:6]},
            "black": {"advantages": adv_b[:6], "disadvantages": dis_b[:6]}}

# Analyzes uploaded PGN file
@learn_router.post("/analyze-pgn")
async def analyze_pgn(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    name = (file.filename or "").lower()
    if not (name.endswith(".pgn") or name.endswith(".txt") or name.endswith(".pgn.txt")):
        raise HTTPException(status_code=415, detail="Upload a .pgn file")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PGN file must be under 10 MB")
    try:
        text = data.decode("utf-8", errors="replace")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode PGN file")
    stream = io.StringIO(text)
    games_out = []
    idx = 0
    while True:
        try:
            game = chess.pgn.read_game(stream)
        except Exception as e:
            logger.warning(f"[learn] PGN parse error at game {idx}: {e}")
            break
        if game is None:
            break
        if idx >= MAX_GAMES:
            games_out.append({"index": idx, "truncated": True, "note": f"Only first {MAX_GAMES} games analyzed"})
            break
        board = game.board()
        moves = []
        ply = 0
        for move in game.mainline_moves():
            if ply >= MAX_PLIES_PER_GAME:
                break
            try:
                fen_before = board.fen()
                san = board.san(move)
                uci = move.uci()
                is_white = board.turn == chess.WHITE
                board.push(move)
                fen_after = board.fen()
            except Exception:
                continue
            ply += 1
            cp_before = await _eval_cp(fen_before)
            cp_after = await _eval_cp(fen_after)
            cp_loss = (cp_before - cp_after) if is_white else (cp_after - cp_before)
            cp_loss = max(0, cp_loss)
            pos = None
            pos_before = None
            try:
                pos = PositionalEvaluator.evaluate(fen_after)
            except Exception:
                pass
            try:
                pos_before = PositionalEvaluator.evaluate(fen_before)
            except Exception:
                pass
            win_w = round(eval_to_win_prob(cp_after) * 100.0, 1)
            draw = (pos or {}).get("win_probabilities", {}).get("draw") if pos else None
            side = "white" if is_white else "black"
            classification = _classify(cp_loss)
            try:
                feedback = _move_pros_cons(
                    (pos_before or {}).get("parameters") if pos_before else None,
                    (pos or {}).get("parameters") if pos else None,
                    side, cp_loss, classification)
            except Exception:
                feedback = {"advantages": [], "disadvantages": [], "summary": classification}
            moves.append({
                "ply": ply, "san": san, "uci": uci,
                "side": side,
                "fen_before": fen_before, "fen_after": fen_after,
                "eval_cp": cp_after, "eval_before_cp": cp_before,
                "cp_loss": cp_loss, "classification": classification,
                "win_white": win_w, "draw": draw,
                "parameters": (pos or {}).get("parameters"),
                "game_phase": (pos or {}).get("game_phase"),
                "advantages": feedback.get("advantages", []),
                "disadvantages": feedback.get("disadvantages", []),
                "move_summary": feedback.get("summary", ""),
            })
        headers = {k: str(v) for k, v in (game.headers or {}).items()}
        white_acc = None
        black_acc = None
        try:
            wl = [m["cp_loss"] for m in moves if m["side"] == "white"]
            bl = [m["cp_loss"] for m in moves if m["side"] == "black"]
            if wl:
                white_acc = round(sum(max(0.0, 100.0 - c / 10.0) for c in wl) / len(wl), 1)
            if bl:
                black_acc = round(sum(max(0.0, 100.0 - c / 10.0) for c in bl) / len(bl), 1)
        except Exception:
            pass
        games_out.append({
            "index": idx,
            "headers": {"White": headers.get("White", f"White G{idx+1}"),
                        "Black": headers.get("Black", f"Black G{idx+1}"),
                        "Result": headers.get("Result", "*"),
                        "Event": headers.get("Event", ""), "Date": headers.get("Date", "")},
            "result": headers.get("Result", "*"),
            "move_count": len(moves),
            "moves": moves,
            "accuracy_white": white_acc,
            "accuracy_black": black_acc,
        })
        idx += 1
    if not games_out:
        raise HTTPException(status_code=422, detail="No games found in the PGN file")
    return {"game_count": len([g for g in games_out if "moves" in g]), "games": games_out}

# Defines learn position request schema
class PositionBody(BaseModel):
    fen: str
    top_k: int = 3

# Analyzes learning position for coaching
@learn_router.post("/analyze-position")
async def analyze_learn_position(body: PositionBody, current_user: dict = Depends(get_current_user)):
    try:
        board = chess.Board(body.fen)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid FEN")
    try:
        pos = PositionalEvaluator.evaluate(board.fen())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    top_k = max(1, min(int(body.top_k or 3), 10))
    try:
        cands = await _learn_engine.get_top_moves(board.fen(), count=top_k, depth=EVAL_DEPTH)
    except Exception:
        cands = []
    flipped = board.copy()
    flipped.turn = not board.turn
    try:
        cands_flipped = await _learn_engine.get_top_moves(flipped.fen(), count=top_k, depth=EVAL_DEPTH)
    except Exception:
        cands_flipped = []
    return {
        "fen": board.fen(),
        "turn": "white" if board.turn == chess.WHITE else "black",
        "is_game_over": board.is_game_over(),
        "legal_move_count": len(list(board.legal_moves)),
        "evaluation": pos,
        "candidates_side_to_move": cands,
        "candidates_flipped_side": {"fen": flipped.fen(), "candidates": cands_flipped},
    }

# Section api/admin

logger = logging.getLogger(__name__)


admin_router = APIRouter(prefix="/admin", tags=["admin"])


BACKEND_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BACKEND_DIR / "data" / "uploads"
CHECKPOINT_DIR = BACKEND_DIR / "checkpoints"
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)


_JOBS: dict[str, dict] = {}


# Returns current UTC timestamp
def _utcnow():
    return datetime.now(timezone.utc)

# Converts user doc to public dict
def _pub_user(u: dict) -> dict:
    return {
        "id": str(u["_id"]),
        "username": u.get("username"),
        "display_name": u.get("display_name"),
        "email": u.get("email"),
        "role": u.get("role", "user"),
        "is_blocked": bool(u.get("is_blocked", False)),
        "created_at": _as_utc(u.get("created_at")),
        "avatar_url": u.get("avatar_url"),
        "bio": u.get("bio"),
    }

# Lists users for admin search
@admin_router.get("/users")
async def list_users(q: str = "", admin: dict = Depends(require_admin)):
    db = get_db()
    filt: dict = {}
    if q:
        filt = {"$or": [
            {"username": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]}
    users = []
    async for u in db.users.find(filt).sort("created_at", -1).limit(500):
        users.append(_pub_user(u))
    return {"users": users, "count": len(users)}

# Defines admin user update schema
class UpdateUserRequest(BaseModel):
    role: Optional[str] = None
    is_blocked: Optional[bool] = None

# Updates user record as admin
@admin_router.patch("/users/{user_id}")
async def update_user(user_id: str, body: UpdateUserRequest, admin: dict = Depends(require_admin)):
    db = get_db()
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=404, detail="User not found")
    target = await db.users.find_one({"_id": oid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if str(target["_id"]) == str(admin["_id"]):
        if body.is_blocked:
            raise HTTPException(status_code=400, detail="You cannot block yourself")
        if body.role and body.role != "admin":
            raise HTTPException(status_code=400, detail="You cannot demote yourself")
    updates: dict = {}
    if body.role is not None:
        if body.role not in ("admin", "user"):
            raise HTTPException(status_code=422, detail="role must be admin or user")
        if target.get("role") == "admin" and body.role == "user":
            count = await db.users.count_documents({"role": "admin"})
            if count <= 1:
                raise HTTPException(status_code=400, detail="Cannot remove the last admin")
        updates["role"] = body.role
    if body.is_blocked is not None:
        updates["is_blocked"] = bool(body.is_blocked)
        updates["blocked_at"] = _utcnow() if body.is_blocked else None
    if updates:
        await db.users.update_one({"_id": oid}, {"$set": updates})
    updated = await db.users.find_one({"_id": oid})
    return _pub_user(updated)

# Returns player dossier with recent battles
@admin_router.get("/users/{user_id}/overview")
async def user_overview(user_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=404, detail="User not found")
    user = await db.users.find_one({"_id": oid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    uid = str(user["_id"])
    filt = {"$or": [{"white_id": uid}, {"black_id": uid}]}
    games = []
    async for g in db.games.find(filt).sort("started_at", -1).limit(20):
        games.append({
            "id": str(g["_id"]), "mode": g.get("mode"), "result": g.get("result"),
            "bot_engine": g.get("bot_engine"), "started_at": _as_utc(g.get("started_at")),
        })
    try:
        games_played = await db.games.count_documents(filt)
    except Exception:
        games_played = len(games)
    summaries = []
    try:
        async for s in db.game_summaries.find({}).sort("_id", -1).limit(5):
            summaries.append({"game_id": s.get("game_id"), "summary_text": (s.get("summary_text") or "")[:300]})
    except Exception:
        pass
    return {
        "user": _pub_user(user),
        "games_played": games_played,
        "recent_games": games,
        "game_count": len(games),
    }

# Persists training job to database
async def _persist_job(job: dict):
    try:
        db = get_db()
        job.pop("_id", None)
        await db.training_jobs.replace_one({"job_id": job["job_id"]}, job, upsert=True)
        job.pop("_id", None)
    except Exception:
        pass

# Converts job to JSON-safe response dict
def _pub_job(job: dict) -> dict:
    return {k: v for k, v in job.items() if k != "_id"}

# Builds filesystem-safe stem from model name
def _slugify(name: str, fallback: str) -> str:
    import re
    slug = re.sub(r"[^a-z0-9-_]+", "-", (name or "").strip().lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)[:60].strip("-")
    return slug or fallback

# Returns non-colliding checkpoint path
def _unique_ckpt_path(slug: str) -> str:
    cand = CHECKPOINT_DIR / f"{slug}.pt"
    if not cand.exists():
        return str(cand)
    i = 2
    while True:
        cand = CHECKPOINT_DIR / f"{slug}-{i}.pt"
        if not cand.exists():
            return str(cand)
        i += 1

# Checks whether model name already exists
async def _name_taken(name: str, exclude_model_id: Optional[str] = None) -> bool:
    models = await gm_list_models(include_unpublished=True)
    want = (name or "").strip().lower()
    return any(((m.get("name") or "").strip().lower() == want)
               and m.get("model_id") != exclude_model_id for m in models)

# Generates unique model name with suffix
async def _ensure_unique_name(name: str, exclude_model_id: Optional[str] = None) -> str:
    base = (name or "").strip() or "GM model"
    if not await _name_taken(base, exclude_model_id):
        return base
    i = 2
    while await _name_taken(f"{base} ({i})", exclude_model_id):
        i += 1
    return f"{base} ({i})"

# Checks whether path is transient upload
def _is_upload_pgn(path: str) -> bool:
    try:
        return bool(path) and Path(path).resolve().is_relative_to(UPLOAD_DIR.resolve())
    except Exception:
        return False

# Loads training job by identifier
async def _load_job(job_id: str) -> Optional[dict]:
    job = _JOBS.get(job_id)
    if job is not None:
        return job
    try:
        db = get_db()
        j = await db.training_jobs.find_one({"job_id": job_id})
        if j:
            j.pop("_id", None)
            _JOBS[job_id] = j
            return j
    except Exception:
        pass
    return None

# Recovers interrupted jobs as resumable-paused
async def recover_interrupted_jobs():
    try:
        db = get_db()
        async for j in db.training_jobs.find({"status": {"$in": ["queued", "running", "pausing"]}}):
            j.pop("_id", None)
            done_epochs = len(j.get("epoch_checkpoints") or [])
            total = int((j.get("config") or {}).get("epochs", 0) or 0)
            j.update({
                "status": "paused",
                "pause_requested": False,
                "resume_from": max(0, min(done_epochs, total)),
                "log": (j.get("log") or []) + [
                    "Server restarted mid-training — preserved as paused. "
                    f"Resume restarts epoch {min(done_epochs + 1, max(total, 1))} from scratch."],
            })
            _JOBS[j["job_id"]] = j
            await _persist_job(j)
            logger.info(f"[train] recovered interrupted job {j['job_id']} as paused")
    except Exception as e:
        logger.warning(f"[train] recovery failed: {e}")

# Persists final model checkpoint to disk
def _save_final_checkpoint(model, cfg: dict, ckpt_path: str):
    import torch
    payload = {
        "state_dict": model.state_dict(),
        "config": {
            "num_blocks": int(cfg.get("num_blocks", 4)),
            "channels": int(cfg.get("channels", 128)),
        },
    }
    torch.save(payload, ckpt_path)

# Returns PGN text for training job
async def _pgn_text_for_job(job: dict) -> str:
    grid_id = job.get("pgn_gridfs_id")
    if grid_id:
        return await pgn_get_text(grid_id)
    pgn_path = job.get("pgn_path") or ""
    return Path(pgn_path).read_text(encoding="utf-8", errors="replace")

# Runs background model training task
async def _run_training(job_id: str, cfg: dict, created_by: str,
                        resume_from: int = 0, resume_ckpt: Optional[str] = None):
    job = await _load_job(job_id)
    if not job:
        return
    if job.get("status") == "cancelled":
        return
    job.update({"status": "running", "progress": job.get("progress", 1.0),
                "pause_requested": False})
    if not job.get("log"):
        job["log"] = []
    job["log"].append(
        f"Job {'resumed' if resume_from else 'started'}. "
        f"{'Continuing' if resume_from else 'Counting'} games…"
        if resume_from else "Job started. Counting games…")
    await _persist_job(job)
    try:
        from gm import GMChessDataset, GMPolicyValueNet, TORCH_AVAILABLE
        if not TORCH_AVAILABLE or GMChessDataset is None or GMPolicyValueNet is None:
            raise RuntimeError("torch is not installed in this environment — install backend requirements (pip install -r requirements.txt, torch>=2.0.0) then retry")
        import copy
        import torch
        import torch.nn as nn
        from torch.utils.data import DataLoader
        requested = int(cfg.get("max_games", 0) or 0)
        try:
            pgn_text = await _pgn_text_for_job(job)
        except Exception as e:
            raise RuntimeError(f"Could not read the training PGN ({e})")
        if requested <= 0:
            try:
                import chess.pgn as _pgn
                import io as _io
                n = 0
                stream = _io.StringIO(pgn_text)
                while _pgn.read_game(stream) is not None:
                    n += 1
                    if n >= 5000:
                        break
                requested = max(1, n)
                cfg["max_games"] = requested
                cfg["detected_games"] = requested
            except Exception:
                requested = 200
                cfg["max_games"] = requested
        ds = GMChessDataset(pgn_data_str=pgn_text, max_games=requested)
        if len(ds) == 0:
            raise RuntimeError("No training positions parsed from the PGN file — check it contains complete games with moves")
        if not job.get("positions"):
            job["log"].append(f"Parsed {len(ds)} positions from {requested} game(s). Training…")
        job["positions"] = len(ds)
        await _persist_job(job)
        loader = DataLoader(ds, batch_size=int(cfg.get("batch_size", 32)), shuffle=True)
        model = GMPolicyValueNet(num_res_blocks=int(cfg.get("num_blocks", 4)),
                                 channels=int(cfg.get("channels", 128)))
        opt = torch.optim.Adam(model.parameters(), lr=float(cfg.get("lr", 0.001)))
        ce = nn.CrossEntropyLoss()
        mse = nn.MSELoss()
        epochs = max(1, min(50, int(cfg.get("epochs", 3))))

        # Performs single SGD training step
        def _train_step(x, y_action, y_value):
            logits, value = model(x)
            loss = ce(logits, y_action) + mse(value, y_value)
            opt.zero_grad()
            loss.backward()
            opt.step()
            return float(loss.item())
        start_ep = 0
        if resume_from > 0 and resume_ckpt:
            try:
                payload = torch.load(resume_ckpt, map_location="cpu", weights_only=True)
                model.load_state_dict(payload["model"])
                opt.load_state_dict(payload["optimizer"])
                start_ep = max(0, min(epochs, int(payload.get("completed_epochs", resume_from))))
                job["log"].append(f"Resumed from epoch checkpoint ({start_ep}/{epochs} complete). Restarting epoch {start_ep + 1}.")
            except Exception as e:
                job["log"].append(f"Resume checkpoint unreadable ({e}); restarting from epoch 1.")
                start_ep = 0
        elif resume_from > 0:
            start_ep = max(0, min(epochs, resume_from))
        total_steps = epochs * max(1, len(loader))
        step = start_ep * max(1, len(loader))
        epoch_ckpts: list[str] = list(job.get("epoch_checkpoints") or [])
        for ep in range(start_ep, epochs):
            try:
                snap_model = copy.deepcopy(model.state_dict())
                snap_opt = copy.deepcopy(opt.state_dict())
            except Exception:
                snap_model, snap_opt = None, None
            model.train()
            ep_loss = 0.0
            for bi, batch in enumerate(loader):
                live = await _load_job(job_id)
                if not live or live.get("status") == "cancelled":
                    return
                if live.get("pause_requested"):
                    if snap_model is not None:
                        try:
                            model.load_state_dict(snap_model)
                            opt.load_state_dict(snap_opt)
                        except Exception:
                            pass
                    live.update({"status": "paused", "pause_requested": False,
                                 "resume_from": ep,
                                 "log": live.get("log", []) + [
                                     f"Paused during epoch {ep + 1}/{epochs} — partial epoch discarded. Resume restarts epoch {ep + 1}."]})
                    await _persist_job(live)
                    return
                x = batch["tensor"]
                y_action = batch["action"]
                y_value = batch["outcome"].unsqueeze(1)
                loss_val = await asyncio.to_thread(_train_step, x, y_action, y_value)
                ep_loss += loss_val
                step += 1
                if bi % 5 == 0:
                    job["progress"] = round(min(99.9, step / total_steps * 100.0), 1)
                    job["current_epoch"] = ep + 1
                    job["current_loss"] = round(loss_val, 4)
                    await _persist_job(job)
            ep_ckpt = str(CHECKPOINT_DIR / f"resnet_job_{job_id[:8]}_e{ep + 1}.pt")
            try:
                torch.save({"model": model.state_dict(), "optimizer": opt.state_dict(),
                            "completed_epochs": ep + 1, "config": cfg}, ep_ckpt)
                if ep_ckpt not in epoch_ckpts:
                    epoch_ckpts.append(ep_ckpt)
            except Exception as e:
                job["log"].append(f"Warning: epoch checkpoint failed ({e}).")
            job["epoch_checkpoints"] = epoch_ckpts
            job["log"].append(f"Epoch {ep + 1}/{epochs} loss={ep_loss / max(1, len(loader)):.4f} positions={len(ds)}")
            job["progress"] = round((ep + 1) / epochs * 100.0, 1)
            job["current_epoch"] = ep + 1
            await _persist_job(job)
        ckpt_name = f"resnet_job_{job_id[:8]}.pt"
        ckpt_path = str(CHECKPOINT_DIR / ckpt_name)
        _save_final_checkpoint(model, cfg, ckpt_path)
        model_id = f"resnet_job_{job_id[:8]}"
        try:
            db = get_db()
            exists = await db.gm_models.find_one({"model_id": model_id})
            published = bool(exists.get("published")) if exists else False
        except Exception:
            published = False
        model_name = await _ensure_unique_name(
            f"Forge {job.get('created_at', '')[:10]} · {requested} games · {epochs}ep", model_id)
        await gm_upsert_model({
            "model_id": model_id,
            "job_id": job_id,
            "name": model_name,
            "checkpoint_path": ckpt_path,
            "epoch_checkpoints": [],
            "pgn_storage": job.get("pgn_storage", "disk"),
            "pgn_gridfs_id": job.get("pgn_gridfs_id"),
            "pgn_path": job.get("pgn_path"),
            "pgn_filename": job.get("pgn_filename"),
            "config": cfg,
            "positions": len(ds),
            "published": published,
            "created_by": created_by,
            "created_at": _as_utc(job.get("created_at")),
        })
        removed_epochs: list[str] = []
        for p in epoch_ckpts:
            try:
                if p and os.path.exists(p):
                    os.remove(p)
                    removed_epochs.append(p)
            except Exception:
                pass
        job.update({"status": "done", "progress": 100.0, "checkpoint_path": ckpt_path,
                    "epoch_checkpoints": [],
                    "model_id": model_id, "positions": len(ds),
                    "log": job["log"] + [
                        f"Saved {ckpt_path} (unpublished — publish it to share with players)",
                        f"Removed {len(removed_epochs)} epoch checkpoint(s) — final model kept."]})
        await _persist_job(job)
    except Exception as e:
        logger.exception(f"[train] job {job_id} failed: {e}")
        job.update({"status": "failed", "error": f"{type(e).__name__}: {e}"})
        await _persist_job(job)

# Migrates disk uploads into GridFS
async def migrate_uploads_to_gridfs() -> dict:
    summary = {"migrated": [], "skipped_orphans": [], "errors": []}
    try:
        storage = await get_db_storage()
    except Exception as e:
        summary["errors"].append(f"storage probe failed: {e}")
        return summary
    if storage["over_threshold"]:
        summary["errors"].append(
            f"MongoDB is {storage['percent']}% full — migration skipped until below "
            f"{storage['threshold_pct']}%.")
        return summary
    try:
        db = get_db()
    except Exception as e:
        summary["errors"].append(f"db unavailable: {e}")
        return summary
    try:
        files = sorted(UPLOAD_DIR.glob("train_*.pgn")) if UPLOAD_DIR.exists() else []
    except Exception:
        files = []
    for path in files:
        try:
            data = path.read_bytes()
        except Exception as e:
            summary["errors"].append(f"{path.name}: unreadable ({e})")
            continue
        refs = []
        try:
            async for j in db.training_jobs.find({"pgn_path": str(path)}):
                refs.append(("job", j["job_id"]))
            async for m in db.gm_models.find({"pgn_path": str(path)}):
                refs.append(("model", m["model_id"]))
        except Exception as e:
            summary["errors"].append(f"{path.name}: lookup failed ({e})")
            continue
        if not refs:
            summary["skipped_orphans"].append(path.name)
            continue
        try:
            grid_id = await pgn_put(path.name, data)
        except Exception as e:
            summary["errors"].append(f"{path.name}: upload failed ({e})")
            continue
        try:
            await db.training_jobs.update_many(
                {"pgn_path": str(path)},
                {"$set": {"pgn_storage": "gridfs", "pgn_gridfs_id": grid_id,
                          "pgn_path": None, "pgn_filename": path.name}})
            await db.gm_models.update_many(
                {"pgn_path": str(path)},
                {"$set": {"pgn_storage": "gridfs", "pgn_gridfs_id": grid_id,
                          "pgn_path": None, "pgn_filename": path.name}})
            for jid, _ in [r for r in refs if r[0] == "job"]:
                job = _JOBS.get(jid)
                if job is not None:
                    job.update({"pgn_storage": "gridfs", "pgn_gridfs_id": grid_id,
                                "pgn_path": None, "pgn_filename": path.name})
                    await _persist_job(job)
            path.unlink()
            summary["migrated"].append(path.name)
        except Exception as e:
            summary["errors"].append(f"{path.name}: repoint failed ({e})")
            try:
                await pgn_delete(grid_id)
            except Exception:
                pass
    try:
        if UPLOAD_DIR.exists() and not any(UPLOAD_DIR.iterdir()):
            UPLOAD_DIR.rmdir()
    except Exception:
        pass
    return summary

# Migrates disk uploads when space frees
async def storage_migrator_loop():
    from core import get_settings
    while True:
        try:
            interval = max(60, int(get_settings().mongodb_migrator_interval_seconds or 300))
        except Exception:
            interval = 300
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            break
        try:
            has_files = UPLOAD_DIR.exists() and any(
                p for p in UPLOAD_DIR.glob("train_*.pgn") if p.is_file())
        except Exception:
            has_files = False
        if not has_files:
            continue
        try:
            result = await migrate_uploads_to_gridfs()
            if result.get("migrated"):
                logger.info(f"[storage] background migrated {len(result['migrated'])} upload(s)")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning(f"[storage] background migration failed: {e}")

# Triggers manual upload migration to GridFS
@admin_router.post("/train/migrate-now")
async def migrate_now(admin: dict = Depends(require_admin)):
    return await migrate_uploads_to_gridfs()

# Starts model training job from upload
@admin_router.post("/train")
async def start_training(
    file: UploadFile = File(...),
    max_games: int = Form(0),
    epochs: int = Form(3),
    batch_size: int = Form(32),
    lr: float = Form(0.001),
    num_blocks: int = Form(4),
    channels: int = Form(128),
    admin: dict = Depends(require_admin),
):
    name = (file.filename or "upload.pgn").lower()
    if not (name.endswith(".pgn") or name.endswith(".txt")):
        raise HTTPException(status_code=415, detail="Upload a .pgn file")
    job_id = uuid.uuid4().hex
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PGN file must be under 50 MB")
    storage = await get_db_storage()
    if not storage["over_threshold"]:
        await migrate_uploads_to_gridfs()
        storage = await get_db_storage()
    filename = file.filename or "upload.pgn"
    if storage["over_threshold"]:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        dest = UPLOAD_DIR / f"train_{job_id}.pgn"
        dest.write_bytes(data)
        pgn_ref = {"pgn_storage": "disk", "pgn_gridfs_id": None,
                   "pgn_path": str(dest), "pgn_filename": filename}
        storage_note = (f"MongoDB is {storage['percent']}% full "
                        f"(≥{storage['threshold_pct']}% budget) — this upload stays in the "
                        f"disk folder until storage is cleared. It will migrate automatically.")
    else:
        grid_id = await pgn_put(f"train_{job_id}.pgn", bytes(data))
        pgn_ref = {"pgn_storage": "gridfs", "pgn_gridfs_id": grid_id,
                   "pgn_path": None, "pgn_filename": filename}
        storage_note = None
    detected = 0
    try:
        import chess.pgn as _pgn
        import io as _io
        stream = _io.StringIO(data.decode("utf-8", errors="replace"))
        while _pgn.read_game(stream) is not None:
            detected += 1
            if detected >= 5000:
                break
    except Exception:
        detected = 0
    resolved_games = max(1, min(5000, detected or (max_games or 0) or 200))
    cfg = {"max_games": resolved_games, "detected_games": detected,
           "epochs": max(1, min(50, epochs)),
           "batch_size": max(8, min(256, batch_size)), "lr": lr,
           "num_blocks": max(1, min(8, num_blocks)), "channels": 128 if channels != 64 else 64}
    job = {"job_id": job_id, "status": "queued", "progress": 0.0, "created_by": str(admin["_id"]),
           "created_at": _utcnow().isoformat(), "config": cfg,
           **pgn_ref,
           "pause_requested": False, "resume_from": 0, "epoch_checkpoints": [],
           "log": [f"Queued. Detected {detected} game(s) in upload."]}
    _JOBS[job_id] = job
    await _persist_job(job)
    asyncio.create_task(_run_training(job_id, cfg, str(admin["_id"])))
    out = {"job_id": job_id, "status": "queued", "config": cfg,
           "pgn_storage": pgn_ref["pgn_storage"], "storage": storage}
    if storage_note:
        out["storage_warning"] = storage_note
    return out

# Requests pause at next batch boundary
@admin_router.post("/train/jobs/{job_id}/pause")
async def pause_job(job_id: str, admin: dict = Depends(require_admin)):
    job = await _load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("status") not in ("queued", "running", "pausing"):
        raise HTTPException(status_code=400, detail=f"Cannot pause a {job.get('status')} job")
    if job.get("status") == "queued":
        job.update({"status": "paused", "pause_requested": False, "resume_from": 0,
                    "log": job.get("log", []) + ["Paused before training started."]})
        await _persist_job(job)
        return _pub_job(job)
    job.update({"pause_requested": True, "status": "pausing"})
    await _persist_job(job)
    return _pub_job(job)

# Resumes paused job from checkpoint
@admin_router.post("/train/jobs/{job_id}/resume")
async def resume_job(job_id: str, admin: dict = Depends(require_admin)):
    job = await _load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    status = job.get("status")
    if status == "pausing":
        job.update({"status": "running", "pause_requested": False})
        await _persist_job(job)
        return _pub_job(job)
    if status != "paused":
        raise HTTPException(status_code=400, detail=f"Cannot resume a {status} job")
    resume_from = int(job.get("resume_from", 0) or 0)
    ckpts: list[str] = list(job.get("epoch_checkpoints") or [])
    resume_ckpt = ckpts[-1] if ckpts and resume_from > 0 else None
    if resume_ckpt and not os.path.exists(resume_ckpt):
        resume_ckpt = None
        resume_from = 0
    job.update({"status": "queued", "pause_requested": False,
                "log": job.get("log", []) + [
                    f"Resuming at epoch {resume_from + 1}." if resume_from else "Resuming from the start."]})
    await _persist_job(job)
    asyncio.create_task(_run_training(job_id, job["config"],
                                      job.get("created_by", str(admin["_id"])),
                                      resume_from=resume_from, resume_ckpt=resume_ckpt))
    return _pub_job(job)

# Deletes training job and checkpoints
@admin_router.delete("/train/jobs/{job_id}")
async def delete_job(job_id: str, admin: dict = Depends(require_admin)):
    job = await _load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        _mid = job.get("model_id") or f"resnet_job_{job_id[:8]}"
        _doc = await gm_get_model_doc(_mid, include_unpublished=True)
        if _doc and _doc.get("published"):
            raise HTTPException(status_code=400,
                                detail="This forging's brain is published — unpublish it before deleting.")
    except HTTPException:
        raise
    except Exception:
        pass
    if job.get("status") in ("running", "pausing", "queued"):
        job.update({"status": "cancelled", "pause_requested": False,
                    "log": job.get("log", []) + ["Cancelled by admin (job deleted)."]})
        await _persist_job(job)
    removed: list[str] = []
    for key in ("checkpoint_path",):
        p = job.get(key)
        if p and os.path.exists(p):
            try:
                os.remove(p)
                removed.append(p)
            except Exception:
                pass
    for p in job.get("epoch_checkpoints") or []:
        if p and os.path.exists(p):
            try:
                os.remove(p)
                removed.append(p)
            except Exception:
                pass
    removed_pgn: list[str] = []
    if job.get("pgn_gridfs_id"):
        try:
            if await pgn_delete(job["pgn_gridfs_id"]):
                removed_pgn.append(f"gridfs:{job['pgn_gridfs_id']}")
        except Exception:
            pass
    else:
        pgn = job.get("pgn_path")
        if pgn and os.path.exists(pgn) and _is_upload_pgn(pgn):
            try:
                os.remove(pgn)
                removed_pgn.append(pgn)
            except Exception:
                pass
    removed.extend(removed_pgn)
    try:
        model_id = job.get("model_id") or f"resnet_job_{job_id[:8]}"
        doc = await gm_delete_model_doc(model_id)
        if doc:
            gm_evict_model(doc["checkpoint_path"])
    except Exception:
        pass
    _JOBS.pop(job_id, None)
    try:
        db = get_db()
        await db.training_jobs.delete_one({"job_id": job_id})
    except Exception:
        pass
    return {"deleted": job_id, "removed_files": removed}

# Reports training environment health
@admin_router.get("/train/env")
async def train_env(admin: dict = Depends(require_admin)):
    try:
        from gm import TORCH_AVAILABLE
    except Exception:
        TORCH_AVAILABLE = False
    torch_version = None
    if TORCH_AVAILABLE:
        try:
            import torch
            torch_version = torch.__version__
        except Exception:
            pass
    storage = await get_db_storage()
    return {
        "torch_available": bool(TORCH_AVAILABLE),
        "torch_version": torch_version,
        "checkpoint_dir": str(CHECKPOINT_DIR),
        "checkpoint_writable": os.access(CHECKPOINT_DIR, os.W_OK),
        "hint": None if TORCH_AVAILABLE else "torch is not installed — run: pip install -r requirements.txt (torch>=2.0.0)",
        "storage": storage,
        "storage_message": (
            "MongoDB is over its storage budget — new uploads spill to the disk "
            "folder until storage is cleared. They migrate back automatically."
            if storage["over_threshold"] else None
        ),
    }

# Lists training jobs for admin
@admin_router.get("/train/jobs")
async def list_jobs(admin: dict = Depends(require_admin)):
    jobs = sorted((_pub_job(j) for j in _JOBS.values()),
                  key=lambda j: j.get("created_at", ""), reverse=True)
    if not jobs:
        try:
            db = get_db()
            out = []
            async for j in db.training_jobs.find({}).sort("created_at", -1).limit(20):
                out.append(_pub_job(j))
            return {"jobs": out}
        except Exception:
            pass
    return {"jobs": jobs}

# Fetches training job status by ID
@admin_router.get("/train/jobs/{job_id}")
async def job_status(job_id: str, admin: dict = Depends(require_admin)):
    job = await _load_job(job_id)
    if job:
        return _pub_job(job)
    raise HTTPException(status_code=404, detail="Job not found")

# Lists all trained models for admin
@admin_router.get("/models")
async def admin_list_models(admin: dict = Depends(require_admin)):
    return {"models": await gm_list_models(include_unpublished=True)}

# Defines model publish request schema
class PublishBody(BaseModel):
    published: bool = True
    name: Optional[str] = None

# Publishes or unpublishes trained model
@admin_router.post("/models/{model_id}/publish")
async def publish_model(model_id: str, body: PublishBody, admin: dict = Depends(require_admin)):
    doc = await gm_get_model_doc(model_id, include_unpublished=True)
    if not doc:
        raise HTTPException(status_code=404, detail="Model not found")
    if not os.path.exists(doc["checkpoint_path"]):
        raise HTTPException(status_code=400, detail="Checkpoint file is missing — retrain this model")
    doc["published"] = bool(body.published)
    if body.name:
        clean = body.name.strip()[:120]
        if not clean:
            raise HTTPException(status_code=422, detail="Name must not be empty")
        if await _name_taken(clean, exclude_model_id=model_id):
            raise HTTPException(status_code=409, detail=f"Another model is already named '{clean}'")
        doc["name"] = clean
    await gm_upsert_model(doc)
    return doc

# Defines model rename request schema
class RenameBody(BaseModel):
    name: str

# Renames trained model and checkpoint file
@admin_router.patch("/models/{model_id}")
async def rename_model(model_id: str, body: RenameBody, admin: dict = Depends(require_admin)):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name must not be empty")
    if len(name) > 120:
        raise HTTPException(status_code=422, detail="Name must be 120 characters or fewer")
    doc = await gm_get_model_doc(model_id, include_unpublished=True)
    if not doc:
        raise HTTPException(status_code=404, detail="Model not found")
    if await _name_taken(name, exclude_model_id=model_id):
        raise HTTPException(status_code=409, detail=f"Another model is already named '{name}'")
    old_path = doc.get("checkpoint_path")
    if old_path and os.path.exists(old_path):
        new_path = _unique_ckpt_path(_slugify(name, model_id))
        if os.path.abspath(new_path) != os.path.abspath(old_path):
            try:
                os.rename(old_path, new_path)
                doc["checkpoint_path"] = new_path
                gm_evict_model(old_path)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Could not rename checkpoint file: {e}")
    doc["name"] = name
    await gm_upsert_model(doc)
    doc.pop("_id", None)
    return doc

# Deletes trained model and artifacts
@admin_router.delete("/models/{model_id}")
async def delete_model(model_id: str, admin: dict = Depends(require_admin)):
    doc = await gm_get_model_doc(model_id, include_unpublished=True)
    if not doc:
        raise HTTPException(status_code=404, detail="Model not found")
    if doc.get("published"):
        raise HTTPException(status_code=400,
                            detail="This model is published — unpublish it before deleting.")
    doc = await gm_delete_model_doc(model_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Model not found")
    removed: list[str] = []

    # Removes file at path if present
    def _drop(path: str | None):
        if path and os.path.exists(path):
            try:
                os.remove(path)
                removed.append(path)
            except Exception:
                pass

    _drop(doc.get("checkpoint_path"))
    for p in list(doc.get("epoch_checkpoints") or []):
        _drop(p)
    gm_evict_model(doc.get("checkpoint_path") or "")
    jid = doc.get("job_id")
    if jid:
        try:
            job = await _load_job(jid)
            if job:
                if job.get("pgn_gridfs_id"):
                    try:
                        if await pgn_delete(job["pgn_gridfs_id"]):
                            removed.append(f"gridfs:{job['pgn_gridfs_id']}")
                    except Exception:
                        pass
                elif _is_upload_pgn(job.get("pgn_path") or ""):
                    _drop(job.get("pgn_path"))
                for p in list(job.get("epoch_checkpoints") or []):
                    _drop(p)
            _JOBS.pop(jid, None)
            db = get_db()
            await db.training_jobs.delete_one({"job_id": jid})
        except Exception:
            pass
    return {"deleted": model_id, "removed_files": removed}

# Section api/broadcasts

broadcasts_router = APIRouter(prefix="/broadcasts", tags=["broadcasts"])


# Defines broadcast analysis request schema
class BroadcastAnalyzeGameRequest(BaseModel):
    round_id: str
    game_id: str
    tour_id: Optional[str] = None


# Defines broadcast position analysis request schema
class BroadcastPositionRequest(BaseModel):
    fen: str
    multipv: int = 3


# Defines broadcast PGN import request schema
class BroadcastImportRequest(BaseModel):
    pgn: str


# Defines broadcast game prioritization request schema
class BroadcastPrioritizeRequest(BaseModel):
    tour_id: Optional[str] = None
    round_id: str
    game_id: str
    is_live: bool = False


# Returns free live/upcoming/recent broadcasts
@broadcasts_router.get("/top")
async def broadcasts_top(page: int = 1):
    try:
        data = await broadcast_list_top(page)
    except BroadcastError as e:
        raise HTTPException(status_code=502, detail=str(e))
    try:
        await broadcast_track_top_events(data)
    except Exception:
        pass
    return data


# Returns broadcasts with an ongoing round
@broadcasts_router.get("/live")
async def broadcasts_live(nb: int = 20):
    try:
        return {"events": await broadcast_list_live(nb)}
    except BroadcastError as e:
        raise HTTPException(status_code=502, detail=str(e))


# Searches Lichess broadcasts by name
@broadcasts_router.get("/search")
async def broadcasts_search(q: str = ""):
    try:
        return {"events": await broadcast_search_events(q)}
    except BroadcastError as e:
        raise HTTPException(status_code=502, detail=str(e))


# Returns one broadcast tournament with its rounds
@broadcasts_router.get("/tournament/{tour_id}")
async def broadcasts_tournament(tour_id: str):
    try:
        event = await broadcast_get_tournament(tour_id)
        await broadcast_track_tour(event)
        try:
            asyncio.create_task(broadcast_enqueue_full_event(tour_id))
        except Exception:
            pass
        return event
    except BroadcastError as e:
        raise HTTPException(status_code=502, detail=str(e))


# Returns tournament analysis progress and status
@broadcasts_router.get("/tournament/{tour_id}/analysis-progress")
async def broadcasts_tournament_progress(tour_id: str):
    try:
        return await broadcast_event_analysis_progress(tour_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Prioritizes analysis of selected broadcast game
@broadcasts_router.post("/prioritize")
async def broadcasts_prioritize(body: BroadcastPrioritizeRequest):
    try:
        return await broadcast_prioritize_game(
            body.tour_id,
            body.round_id,
            body.game_id,
            body.is_live,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Returns player profile avatar photo image
@broadcasts_router.get("/player-avatar/{fide_id}")
async def broadcasts_player_avatar(fide_id: str):
    data, media = await broadcast_get_player_avatar(fide_id)
    if not data:
        raise HTTPException(status_code=404, detail="Avatar not found")
    return Response(
        content=data,
        media_type=media,
        headers={
            "Cache-Control": "public, max-age=604800, immutable",
            "Content-Type": media,
        },
    )


# Returns one round with live game states and cached analysis summaries
@broadcasts_router.get("/round/{round_id}")
async def broadcasts_round(round_id: str, tour_id: str):
    try:
        detail = await broadcast_get_round(tour_id, round_id)
        await broadcast_track_tour(detail.get("event") or {})
        try:
            await broadcast_enqueue_round_games(detail, priority=1)
        except Exception:
            pass
        game_ids = [g.get("id") for g in (detail.get("games") or []) if g.get("id")]
        analysis_map = await broadcast_analysis_map(round_id, game_ids)
        for game in detail.get("games") or []:
            game["analysis"] = analysis_map.get(game.get("id"))
        return detail
    except BroadcastError as e:
        raise HTTPException(status_code=502, detail=str(e))


# Downloads the PGN for one broadcast round
@broadcasts_router.get("/round/{round_id}/pgn")
async def broadcasts_round_pgn(round_id: str):
    try:
        text = await broadcast_get_round_pgn(round_id)
    except BroadcastError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return PlainTextResponse(text, media_type="application/x-chess-pgn")


# Returns cached analysis or queue status for a broadcast game
@broadcasts_router.get("/analysis")
async def broadcasts_analysis(round_id: str, game_id: str):
    try:
        return await broadcast_analysis_status(round_id, game_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Queues a broadcast game for Stockfish analysis (login required)
@broadcasts_router.post("/analyze-game")
async def broadcasts_analyze_game(
    body: BroadcastAnalyzeGameRequest,
    current_user: dict = Depends(get_current_user),
):
    if not (len(body.round_id) == 8 and body.round_id.isalnum()):
        raise HTTPException(status_code=422, detail="Invalid round id")
    if not (len(body.game_id) == 8 and body.game_id.isalnum()):
        raise HTTPException(status_code=422, detail="Invalid game id")
    try:
        return await broadcast_enqueue_game(
            body.round_id,
            body.game_id,
            body.tour_id,
            priority=0,
            requested_by=current_user.get("username") or str(current_user["_id"]),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Analyses a position with the local Stockfish pool (login required)
@broadcasts_router.post("/analyze-position")
async def broadcasts_analyze_position(
    body: BroadcastPositionRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        board = chess.Board(body.fen)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid FEN")
    try:
        return await analyze_position_for_broadcast(
            board.fen(), multipv=max(1, min(int(body.multipv or 3), 5))
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Imports a PGN and queues it for the same analysis pipeline (login required)
@broadcasts_router.post("/import-pgn")
async def broadcasts_import_pgn(
    body: BroadcastImportRequest,
    current_user: dict = Depends(get_current_user),
):
    pgn_text = (body.pgn or "").strip()
    if not pgn_text:
        raise HTTPException(status_code=400, detail="PGN content is required")
    if len(pgn_text) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PGN is too large")
    round_id = f"import:{uuid.uuid4().hex[:12]}"
    try:
        result = await broadcast_enqueue_game(
            round_id,
            "import",
            None,
            priority=0,
            requested_by=current_user.get("username") or str(current_user["_id"]),
            pgn_text=pgn_text,
        )
        result["round_id"] = round_id
        result["game_id"] = "import"
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Section aggregated router
router = APIRouter()
router.include_router(auth_router)
router.include_router(games_router)
router.include_router(friends_router)
router.include_router(analysis_router)
router.include_router(coach_router)
router.include_router(report_router)
router.include_router(learn_router)
router.include_router(admin_router)
router.include_router(broadcasts_router)
