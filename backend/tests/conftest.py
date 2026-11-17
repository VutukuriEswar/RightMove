import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock
from bson import ObjectId


@pytest.fixture
def fake_game_doc():
    return {
        "_id": ObjectId(),
        "mode": "bot",
        "white_id": "user_white",
        "black_id": None,
        "bot_engine": "stockfish",
        "bot_level": 5,
        "bot_depth": None,
        "maia_elo": None,
        "player_color": "white",
        "time_control_seconds": 600,
        "increment_seconds": 0,
        "fen": None,
        "moves": [],
        "training_mode": False,
    }


@pytest.fixture
def fake_multiplayer_doc():
    return {
        "_id": ObjectId(),
        "mode": "multiplayer",
        "white_id": "user_white",
        "black_id": "user_black",
        "bot_engine": None,
        "bot_level": 5,
        "bot_depth": None,
        "maia_elo": None,
        "player_color": "white",
        "time_control_seconds": 180,
        "increment_seconds": 2,
        "fen": None,
        "moves": [],
        "training_mode": False,
    }


@pytest_asyncio.fixture
async def mock_db():
    db = MagicMock()
    db.matchmaking = MagicMock()
    db.matchmaking.update_one = AsyncMock()
    db.matchmaking.delete_one = AsyncMock()
    db.matchmaking.find_one = AsyncMock(return_value=None)
    db.live_states = MagicMock()
    db.live_states.replace_one = AsyncMock()
    db.live_states.find_one = AsyncMock(return_value=None)
    db.live_states.delete_one = AsyncMock()
    return db
