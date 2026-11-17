import sys
from unittest.mock import MagicMock, AsyncMock
import pytest
from bson import ObjectId

# Mock only torch — heavy import; motor must NOT be mocked (Windows IOCP deadlock)
_TORCH_MODULES = [
    "torch", "torch.nn", "torch.nn.functional",
    "torch.utils", "torch.utils.data", "torch.optim", "torch.cuda",
    "transformers",
]
for _mod in _TORCH_MODULES:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()


@pytest.fixture(autouse=True)
async def reset_matchmaking_event():
    import intelligence
    intelligence._matchmaking_event = None
    yield
    intelligence._matchmaking_event = None


@pytest.fixture
def fresh_db():
    db = MagicMock()
    for attr in ("matchmaking", "users", "live_states"):
        coll = MagicMock()
        coll.find_one = AsyncMock(return_value=None)
        coll.update_one = AsyncMock()
        coll.delete_one = AsyncMock()
        coll.insert_one = AsyncMock(return_value=MagicMock(inserted_id=ObjectId()))
        coll.replace_one = AsyncMock()
        setattr(db, attr, coll)
    return db
