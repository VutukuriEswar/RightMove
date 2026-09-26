# Provides FastAPI application entrypoint with lifespan and routes
import logging
from contextlib import asynccontextmanager
import sys
import asyncio

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI, WebSocket, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from core import get_settings, create_indexes, ensure_admin_seed, close_db
from engines import init_pools, shutdown_pools
from api import router as api_router
from api import recover_interrupted_jobs, _ensure_gm_matcher_warm
from realtime import handle_game_socket, handle_matchmaking_socket
from engines import shutdown_maia

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()


# Manages application startup and shutdown lifecycle
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up RightMove backend…")
    await create_indexes()
    await ensure_admin_seed()
    try:
        await recover_interrupted_jobs()
    except Exception:
        pass

    try:
        from api import migrate_uploads_to_gridfs
        result = await migrate_uploads_to_gridfs()
        if result.get("migrated"):
            logger.info(f"[storage] migrated {len(result['migrated'])} upload(s) to GridFS")
    except Exception as e:
        logger.warning(f"[storage] startup migration failed: {e}")
    init_pools()


    migrator_task = None
    try:
        from api import storage_migrator_loop
        migrator_task = asyncio.create_task(storage_migrator_loop())
    except Exception as e:
        logger.warning(f"[storage] migrator failed to start: {e}")


    try:
        _ensure_gm_matcher_warm()
    except Exception:
        pass
    yield

    logger.info("Shutting down…")
    if migrator_task is not None:
        migrator_task.cancel()
        try:
            await migrator_task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
    try:
        await shutdown_maia()
    except Exception:
        pass
    await shutdown_pools()
    await close_db()


app = FastAPI(
    title="RightMove Chess Platform",
    version="1.0.0",
    lifespan=lifespan,
)


# Configures CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Registers REST routers
app.include_router(api_router)


# Exposes WebSocket endpoints
# Handles game WebSocket connections
@app.websocket("/ws/game/{game_id}")
async def ws_game(game_id: str, websocket: WebSocket, token: str = Query(...)):
    await handle_game_socket(game_id, websocket, token)


# Handles matchmaking WebSocket connections
@app.websocket("/ws/matchmaking")
async def ws_matchmaking(
    websocket: WebSocket,
    token: str = Query(...),
    tc: int = Query(600, ge=0, le=3600),
    inc: int = Query(0, ge=0, le=60)
):
    await handle_matchmaking_socket(websocket, token, tc, inc)


# Returns service health status
@app.get("/health")
async def health():
    return {"status": "ok"}


# Serves built frontend assets
_FRONTEND_BUILD = os.path.join(os.path.dirname(__file__), "..", "frontend", "build")
_CHESS_THEMES   = os.path.join(_FRONTEND_BUILD, "chess-themes")

if os.path.isdir(_CHESS_THEMES):
    app.mount("/chess-themes", StaticFiles(directory=_CHESS_THEMES), name="chess-themes")

if os.path.isdir(_FRONTEND_BUILD):
    app.mount("/", StaticFiles(directory=_FRONTEND_BUILD, html=True), name="frontend")
