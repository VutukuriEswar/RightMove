import sys
import os
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from bson import ObjectId

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


def _make_mock_db():
    db = MagicMock()
    db.matchmaking = MagicMock()
    db.matchmaking.update_one = AsyncMock()
    db.matchmaking.delete_one = AsyncMock()
    db.matchmaking.find_one = AsyncMock(return_value=None)
    return db


class TestEnqueue:
    async def test_enqueue_calls_update_one_with_upsert(self):
        mock_db = _make_mock_db()
        with patch("intelligence.get_db", return_value=mock_db):
            from intelligence import enqueue
            await enqueue("user1", time_control_seconds=600, increment_seconds=0)
        mock_db.matchmaking.update_one.assert_called_once()

    async def test_enqueue_uses_correct_user_filter(self):
        mock_db = _make_mock_db()
        with patch("intelligence.get_db", return_value=mock_db):
            from intelligence import enqueue
            await enqueue("user_xyz", 300, 5)
        call_args = mock_db.matchmaking.update_one.call_args[0]
        assert call_args[0] == {"user_id": "user_xyz"}

    async def test_enqueue_stores_time_control(self):
        mock_db = _make_mock_db()
        with patch("intelligence.get_db", return_value=mock_db):
            from intelligence import enqueue
            await enqueue("player1", time_control_seconds=180, increment_seconds=2)
        update_doc = mock_db.matchmaking.update_one.call_args[0][1]["$set"]
        assert update_doc["time_control_seconds"] == 180
        assert update_doc["increment_seconds"] == 2

    async def test_enqueue_clears_matched_fields(self):
        mock_db = _make_mock_db()
        with patch("intelligence.get_db", return_value=mock_db):
            from intelligence import enqueue
            await enqueue("player1")
        update_doc = mock_db.matchmaking.update_one.call_args[0][1]["$set"]
        assert update_doc["matched_game_id"] is None
        assert update_doc["opponent_id"] is None


class TestDequeue:
    async def test_dequeue_calls_delete_one_with_user_id(self):
        mock_db = _make_mock_db()
        with patch("intelligence.get_db", return_value=mock_db):
            from intelligence import dequeue
            await dequeue("user_abc")
        mock_db.matchmaking.delete_one.assert_called_once_with({"user_id": "user_abc"})


class TestCheckForMatch:
    async def test_returns_none_when_user_not_in_queue(self):
        mock_db = _make_mock_db()
        mock_db.matchmaking.find_one = AsyncMock(return_value=None)
        with patch("intelligence.get_db", return_value=mock_db):
            from intelligence import check_for_match
            result = await check_for_match("missing_user")
        assert result is None

    async def test_returns_matched_game_when_already_matched(self):
        mock_db = _make_mock_db()
        entry = {
            "user_id": "user1",
            "matched_game_id": "game_abc",
            "opponent_id": "user2",
            "time_control_seconds": 600,
            "increment_seconds": 0,
        }
        mock_db.matchmaking.find_one = AsyncMock(side_effect=[entry, None])
        with patch("intelligence.get_db", return_value=mock_db):
            from intelligence import check_for_match
            result = await check_for_match("user1")
        assert result is not None
        assert result["game_id"] == "game_abc"
        assert result["opponent_id"] == "user2"
        assert result["is_creator"] is False

    async def test_returns_opponent_info_when_opponent_waiting(self):
        mock_db = _make_mock_db()
        user_entry = {
            "user_id": "user1", "matched_game_id": None, "opponent_id": None,
            "time_control_seconds": 600, "increment_seconds": 0,
        }
        opponent_entry = {
            "user_id": "user2", "matched_game_id": None, "opponent_id": None,
            "time_control_seconds": 600, "increment_seconds": 0,
        }
        mock_db.matchmaking.find_one = AsyncMock(side_effect=[user_entry, opponent_entry])
        with patch("intelligence.get_db", return_value=mock_db):
            from intelligence import check_for_match
            result = await check_for_match("user1")
        assert result is not None
        assert result["opponent_id"] == "user2"
        assert result["is_creator"] is True

    async def test_returns_none_when_no_opponent_available(self):
        mock_db = _make_mock_db()
        user_entry = {
            "user_id": "user1", "matched_game_id": None, "opponent_id": None,
            "time_control_seconds": 600, "increment_seconds": 0,
        }
        mock_db.matchmaking.find_one = AsyncMock(side_effect=[user_entry, None])
        with patch("intelligence.get_db", return_value=mock_db):
            from intelligence import check_for_match
            result = await check_for_match("user1")
        assert result is None

    async def test_query_filters_by_matching_time_control(self):
        mock_db = _make_mock_db()
        user_entry = {
            "user_id": "user1", "matched_game_id": None, "opponent_id": None,
            "time_control_seconds": 600, "increment_seconds": 0,
        }
        mock_db.matchmaking.find_one = AsyncMock(side_effect=[user_entry, None])
        with patch("intelligence.get_db", return_value=mock_db):
            from intelligence import check_for_match
            await check_for_match("user1")
        second_call_filter = mock_db.matchmaking.find_one.call_args_list[1][0][0]
        assert second_call_filter["time_control_seconds"] == 600


class TestSetMatched:
    async def test_set_matched_updates_opponent_entry(self):
        mock_db = _make_mock_db()
        with patch("intelligence.get_db", return_value=mock_db):
            from intelligence import set_matched
            await set_matched("opponent1", "game_123", "my_user")
        call_args = mock_db.matchmaking.update_one.call_args[0]
        assert call_args[0] == {"user_id": "opponent1"}
        update_doc = call_args[1]["$set"]
        assert update_doc["matched_game_id"] == "game_123"
        assert update_doc["opponent_id"] == "my_user"


class TestWaitForMatchEvent:
    async def test_resolves_on_event_signal(self):
        from intelligence import wait_for_match_event, _get_matchmaking_event
        _get_matchmaking_event().clear()

        async def _signal():
            await asyncio.sleep(0.05)
            _get_matchmaking_event().set()

        asyncio.ensure_future(_signal())
        await wait_for_match_event(timeout=1.0)

    async def test_clears_event_after_resolving(self):
        from intelligence import wait_for_match_event, _get_matchmaking_event
        _get_matchmaking_event().set()
        await wait_for_match_event(timeout=0.5)
        assert not _get_matchmaking_event().is_set()

    async def test_does_not_raise_on_timeout(self):
        from intelligence import wait_for_match_event, _get_matchmaking_event
        _get_matchmaking_event().clear()
        await wait_for_match_event(timeout=0.05)
