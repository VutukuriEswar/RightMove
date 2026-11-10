# Provides core configuration security database and schemas
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
import bcrypt
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field

# Defines application configuration settings
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    secret_key: str = "change-me"
    access_token_expire_minutes: int = 10080


    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "rightmove"


    mongodb_capacity_mb: float = 512.0
    mongodb_storage_threshold_pct: float = 75.0
    mongodb_migrator_interval_seconds: int = 300


    sf_path: str = "./engines/Stockfish/src/stockfish.exe"
    maia3_dir: str = "./engines/Maia-3/maia3"


    frontend_url: str = "http://localhost:5173"


    engine_pool_size: int = 2


    admin_username: str = "EswarVutukuri"
    admin_display_name: str = "Eswar Vutukuri"
    admin_email: str = "vutukurieswar@gmail.com"
    admin_password: str = "123456789"


    hf_explanations_enabled: bool = True
    hf_local_model_id: str = "Qwen/Qwen2.5-1.5B-Instruct"

    # Configures live broadcast and Stockfish analysis options
    lichess_token: str = ""
    broadcast_analysis_depth: int = 12
    broadcast_position_depth: int = 18
    broadcast_auto_analysis_daily_limit: int = 300
    broadcast_engine_hash_mb: int = 128


# Returns cached application settings
@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


# Provides password and JWT helpers
# Hashes plaintext password with bcrypt
def hash_password(plain: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(plain.encode('utf-8'), salt).decode('utf-8')


# Verifies plaintext password against hash
def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))


ALGORITHM = "HS256"


# Creates signed JWT access token
def create_access_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


# Decodes JWT and returns subject
def decode_access_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


settings = get_settings()


# Manages MongoDB connections and storage
_client: AsyncIOMotorClient | None = None


# Returns shared MongoDB client
def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.mongodb_url)
    return _client


# Returns application MongoDB database
def get_db() -> AsyncIOMotorDatabase:
    return get_client()[settings.mongodb_db_name]


# Closes MongoDB client connection
async def close_db():
    global _client
    if _client:
        _client.close()
        _client = None


PGN_BUCKET = "training_pgns"


import logging as _logging
_core_logger = _logging.getLogger(__name__)


# Reports MongoDB storage usage
async def get_db_storage() -> dict:
    s = get_settings()
    capacity = max(0.01, float(s.mongodb_capacity_mb or 512.0))
    threshold = float(s.mongodb_storage_threshold_pct or 75.0)
    used_mb = 0.0
    try:
        stats = await get_db().command("dbStats")
        used_mb = float(stats.get("storageSize", 0) or 0) / (1024 * 1024)
    except Exception as e:
        _core_logger.warning(f"[storage] dbStats failed: {e}")
    used_mb = round(used_mb, 1)
    percent = round(used_mb / capacity * 100.0, 1)
    return {
        "used_mb": used_mb,
        "capacity_mb": capacity,
        "percent": percent,
        "threshold_pct": threshold,
        "over_threshold": percent >= threshold,
    }


# Returns GridFS PGN bucket
def get_pgn_bucket():
    from motor.motor_asyncio import AsyncIOMotorGridFSBucket
    return AsyncIOMotorGridFSBucket(get_db(), bucket_name=PGN_BUCKET)


# Stores PGN bytes in GridFS
async def pgn_put(filename: str, data: bytes) -> str:
    bucket = get_pgn_bucket()
    grid_id = await bucket.upload_from_stream(filename, data)
    return str(grid_id)


# Retrieves PGN text from GridFS
async def pgn_get_text(grid_id: str) -> str:
    import io as _io
    from bson import ObjectId
    bucket = get_pgn_bucket()
    buf = _io.BytesIO()
    await bucket.download_to_stream(ObjectId(grid_id), buf)
    return buf.getvalue().decode("utf-8", errors="replace")


# Deletes PGN file from GridFS
async def pgn_delete(grid_id: str) -> bool:
    from bson import ObjectId
    try:
        await get_pgn_bucket().delete(ObjectId(grid_id))
        return True
    except Exception:
        return False


# Opens PGN text stream from source
async def open_pgn_stream(source: str):
    import io as _io
    import os as _os
    from contextlib import asynccontextmanager


    # Yields PGN text stream context
    @asynccontextmanager
    async def _cm():
        is_grid_id = bool(source) and len(source) == 24 and all(
            c in "0123456789abcdefABCDEF" for c in source)
        if is_grid_id and not _os.path.exists(source):
            yield _io.StringIO(await pgn_get_text(source))
        else:
            fh = open(source, "r", encoding="utf-8", errors="ignore")
            try:
                yield fh
            finally:
                fh.close()

    return _cm()


# Ensures default admin user exists
async def ensure_admin_seed():
    import logging
    from datetime import datetime, timezone
    from core import hash_password
    logger = logging.getLogger(__name__)
    db = get_db()
    try:
        existing = await db.users.count_documents({"role": "admin"})
        if existing and existing > 0:
            return

        username = (settings.admin_username or "").strip()
        email = (settings.admin_email or "").strip()
        password = settings.admin_password or ""
        if not username or not email or not password:
            logger.warning("[seed] No admin configured; skipping admin seed.")
            return
        if await db.users.find_one({"email": email}):
            await db.users.update_one({"email": email}, {"$set": {"role": "admin"}})
            logger.info(f"[seed] Promoted existing user {email} to admin.")
            return
        if await db.users.find_one({"username": username}):
            await db.users.update_one({"username": username}, {"$set": {"role": "admin"}})
            logger.info(f"[seed] Promoted existing user {username} to admin.")
            return
        doc = {
            "username": username,
            "display_name": settings.admin_display_name or username,
            "email": email,
            "password_hash": hash_password(password),
            "created_at": datetime.now(timezone.utc),
            "avatar_url": None,
            "bio": None,
            "role": "admin",
            "is_blocked": False,
            "blocked_at": None,
        }
        res = await db.users.insert_one(doc)
        logger.info(f"[seed] Created admin user {username} ({email}).")
    except Exception as e:
        logger.warning(f"[seed] Admin seed failed: {e}")


# Creates MongoDB indexes
async def create_indexes():
    db = get_db()

    await db.users.create_index("email", unique=True)
    await db.users.create_index("username", unique=True)
    await db.users.create_index("role")

    await db.games.create_index("white_id")
    await db.games.create_index("black_id")
    await db.games.create_index("started_at")

    await db.friendships.create_index([("user_id", 1), ("friend_id", 1)], unique=True)

    await db.challenges.create_index([("to_id", 1), ("status", 1)])
    await db.challenges.create_index([("from_id", 1), ("status", 1)])

    await db.game_summaries.create_index("game_id", unique=True)

    await db.paused_games.create_index("user_id")
    await db.paused_games.create_index("game_id", unique=True)

    await db.training_jobs.create_index("job_id", unique=True)
    await db.gm_models.create_index("model_id", unique=True)

    await db.broadcast_analyses.create_index(
        [("round_id", 1), ("game_id", 1)], unique=True
    )
    await db.broadcast_analyses.create_index("updated_at")
    await db.broadcast_analysis_queue.create_index(
        [("round_id", 1), ("game_id", 1)], unique=True
    )
    await db.broadcast_analysis_queue.create_index(
        [("status", 1), ("priority", 1), ("created_at", 1)]
    )
    await db.broadcast_tracked_tours.create_index("tour_id", unique=True)
    await db.broadcast_tracked_tours.create_index("last_seen")
    await db.broadcast_round_scans.create_index("round_id", unique=True)
    await db.broadcast_event_analysis_state.create_index("tour_id", unique=True)


# Defines API request and response schemas
# Represents user signup request payload
class SignupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: EmailStr
    password: str = Field(min_length=8)


# Represents user login request payload
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# Represents JWT token response payload
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# Represents public user profile data
class UserPublic(BaseModel):
    id: str
    username: str
    display_name: Optional[str]
    email: str
    created_at: datetime
    avatar_url: Optional[str]
    bio: Optional[str]
    role: str = "user"
    is_blocked: bool = False


# Represents profile update request payload
class UpdateProfileRequest(BaseModel):
    display_name: Optional[str] = Field(None, max_length=64)
    email: Optional[EmailStr] = None
    bio: Optional[str] = Field(None, max_length=500)
    current_password: Optional[str] = None
    new_password: Optional[str] = Field(None, min_length=8)


# Represents game creation request payload
class CreateGameRequest(BaseModel):
    mode: Literal["friend", "random", "bot", "pass_and_play"]
    bot_engine: Optional[Literal["stockfish", "maia3"]] = None
    bot_level: Optional[int] = Field(None, ge=1, le=10)
    bot_depth: Optional[int] = Field(None, ge=1, le=20)
    maia_elo: Optional[int] = Field(None, ge=800, le=2500)
    player_color: Optional[Literal["white", "black"]] = None
    training_mode: bool = False
    time_control_seconds: int = Field(600, ge=0, le=3600)
    increment_seconds: int = Field(0, ge=0, le=60)
    friend_username: Optional[str] = None


# Represents public game data
class GamePublic(BaseModel):
    id: str
    white_id: Optional[str]
    black_id: Optional[str]
    white_username: Optional[str] = None
    black_username: Optional[str] = None
    mode: str
    bot_engine: Optional[str]
    bot_level: Optional[int]
    bot_depth: Optional[int] = None
    maia_elo: Optional[int] = None
    player_color: Optional[str] = None
    training_mode: bool = False
    result: str
    started_at: datetime
    ended_at: Optional[datetime]
    time_control_seconds: int
    increment_seconds: int


# Represents aggregated user statistics
class UserStatsPublic(BaseModel):
    wins: int = 0
    draws: int = 0
    losses: int = 0
    games_played: int = 0


# Represents candidate move with explanation
class CandidateMove(BaseModel):
    uci: str
    san: str
    eval_cp: int
    win_prob: float
    explanation: str


# Represents position analysis result
class AnalysisResult(BaseModel):
    fen: str
    stockfish_candidates: list[CandidateMove]


# Represents key game moment data
class KeyMomentPublic(BaseModel):
    ply: int
    san: str
    eval_before_cp: int
    eval_after_cp: int
    delta_win_prob: float
    classification: str


# Represents public game summary data
class GameSummaryPublic(BaseModel):
    game_id: str
    accuracy_white: Optional[float]
    accuracy_black: Optional[float]
    summary_text: Optional[str]
    key_moments: list[KeyMomentPublic]


# Represents friend request payload
class FriendRequest(BaseModel):
    username: str


# Represents game challenge payload
class ChallengeRequest(BaseModel):
    username: str
    time_control_seconds: int = Field(600, ge=0, le=3600)
    increment_seconds: int = Field(0, ge=0, le=60)
    color_preference: Optional[str] = Field("random")
    pgn: Optional[str] = None


# Represents public friendship data
class FriendshipPublic(BaseModel):
    user_id: str
    friend_id: str
    friend_username: str
    status: str


# Defines MongoDB document models
# Returns current UTC timestamp
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Groups user document models
# Models user MongoDB document
class UserDoc(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    username: str
    display_name: Optional[str] = None
    email: str
    password_hash: str
    created_at: datetime = Field(default_factory=utcnow)
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    role: Literal["admin", "user"] = "user"
    is_blocked: bool = False
    blocked_at: Optional[datetime] = None

    model_config = {"populate_by_name": True}


# Groups game document models
GameMode = Literal["friend", "random", "bot", "pass_and_play"]
GameResult = Literal["white", "black", "draw", "ongoing", "aborted"]
BotEngine = Literal["stockfish", "maia3"]


# Models game MongoDB document
class GameDoc(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    white_id: Optional[str] = None
    black_id: Optional[str] = None
    mode: GameMode
    bot_engine: Optional[BotEngine] = None
    bot_level: Optional[int] = None
    bot_depth: Optional[int] = None
    maia_elo: Optional[int] = None
    player_color: Optional[Literal["white", "black"]] = None
    training_mode: bool = False
    result: GameResult = "ongoing"
    started_at: datetime = Field(default_factory=utcnow)
    ended_at: Optional[datetime] = None
    time_control_seconds: int = Field(600, ge=0)
    increment_seconds: int = 0

    model_config = {"populate_by_name": True}


# Groups game summary models
# Models stored key moment data
class KeyMoment(BaseModel):
    ply: int
    san: str
    eval_before_cp: int
    eval_after_cp: int
    delta_win_prob: float
    classification: str


# Models stored game summary document
class GameSummaryDoc(BaseModel):
    game_id: str
    accuracy_white: Optional[float] = None
    accuracy_black: Optional[float] = None
    summary_text: Optional[str] = None
    key_moments: list[KeyMoment] = []


# Groups friendship document models
FriendshipStatus = Literal["pending", "accepted", "rejected"]


# Models friendship MongoDB document
class FriendshipDoc(BaseModel):
    user_id: str
    friend_id: str
    status: FriendshipStatus = "pending"
    created_at: datetime = Field(default_factory=utcnow)
