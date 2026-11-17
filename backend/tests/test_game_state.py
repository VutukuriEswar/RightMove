import pytest
import os
import sys
import time
import chess
from bson import ObjectId
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from realtime import (
    GameState,
    _side_to_move,
    _sender_color,
    live_clocks,
    _get_result,
    _state_to_doc,
)


class TestGameStateInit:
    def test_initializes_with_start_position_when_no_fen(self, fake_game_doc):
        state = GameState(fake_game_doc)
        assert state.board.fen() == chess.Board().fen()

    def test_initializes_from_custom_fen(self, fake_game_doc):
        fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
        fake_game_doc["fen"] = fen
        state = GameState(fake_game_doc)
        assert state.board.piece_at(chess.E4) is not None

    def test_falls_back_to_start_on_invalid_fen(self, fake_game_doc):
        fake_game_doc["fen"] = "not_a_valid_fen"
        state = GameState(fake_game_doc)
        assert state.board.fen() == chess.Board().fen()

    def test_time_control_converted_to_milliseconds(self, fake_game_doc):
        fake_game_doc["time_control_seconds"] = 300
        state = GameState(fake_game_doc)
        assert state.time_control == 300_000

    def test_increment_converted_to_milliseconds(self, fake_game_doc):
        fake_game_doc["increment_seconds"] = 5
        state = GameState(fake_game_doc)
        assert state.increment == 5_000

    def test_clocks_initialized_to_full_time(self, fake_game_doc):
        fake_game_doc["time_control_seconds"] = 600
        state = GameState(fake_game_doc)
        assert state.clocks["white"] == 600_000
        assert state.clocks["black"] == 600_000

    def test_moves_list_starts_empty(self, fake_game_doc):
        state = GameState(fake_game_doc)
        assert state.moves == []

    def test_moves_restored_from_doc(self, fake_game_doc):
        fake_game_doc["moves"] = [{"uci": "e2e4"}, {"uci": "e7e5"}]
        state = GameState(fake_game_doc)
        assert len(state.moves) == 2

    def test_game_id_stringified(self, fake_game_doc):
        state = GameState(fake_game_doc)
        assert isinstance(state.game_id, str)

    def test_clock_not_running_at_init(self, fake_game_doc):
        state = GameState(fake_game_doc)
        assert state.clock_running is False

    def test_result_none_at_init(self, fake_game_doc):
        state = GameState(fake_game_doc)
        assert state.result is None

    def test_training_mode_false_by_default(self, fake_game_doc):
        state = GameState(fake_game_doc)
        assert state.training_mode is False

    def test_training_mode_true_when_set(self, fake_game_doc):
        fake_game_doc["training_mode"] = True
        state = GameState(fake_game_doc)
        assert state.training_mode is True


class TestSideToMove:
    def test_returns_white_at_game_start(self, fake_game_doc):
        state = GameState(fake_game_doc)
        assert _side_to_move(state) == "white"

    def test_returns_black_after_one_move(self, fake_game_doc):
        state = GameState(fake_game_doc)
        state.board.push_uci("e2e4")
        assert _side_to_move(state) == "black"

    def test_alternates_sides_correctly(self, fake_game_doc):
        state = GameState(fake_game_doc)
        state.board.push_uci("e2e4")
        state.board.push_uci("e7e5")
        assert _side_to_move(state) == "white"


class TestSenderColor:
    def test_white_player_returns_white(self, fake_multiplayer_doc):
        state = GameState(fake_multiplayer_doc)
        assert _sender_color(state, "user_white") == "white"

    def test_black_player_returns_black(self, fake_multiplayer_doc):
        state = GameState(fake_multiplayer_doc)
        assert _sender_color(state, "user_black") == "black"

    def test_unknown_player_returns_none(self, fake_multiplayer_doc):
        state = GameState(fake_multiplayer_doc)
        assert _sender_color(state, "stranger") is None

    def test_bot_mode_returns_player_color(self, fake_game_doc):
        fake_game_doc["player_color"] = "white"
        state = GameState(fake_game_doc)
        assert _sender_color(state, "anyone") == "white"


class TestLiveClocks:
    def test_clocks_unchanged_when_not_running(self, fake_game_doc):
        state = GameState(fake_game_doc)
        state.clock_running = False
        clocks = live_clocks(state)
        assert clocks["white"] == 600_000
        assert clocks["black"] == 600_000

    def test_clocks_unchanged_when_no_time_control(self, fake_game_doc):
        fake_game_doc["time_control_seconds"] = 0
        state = GameState(fake_game_doc)
        state.clock_running = True
        clocks = live_clocks(state)
        assert clocks["white"] == 0
        assert clocks["black"] == 0

    def test_white_clock_decreasing_when_running(self, fake_game_doc):
        state = GameState(fake_game_doc)
        state.clock_running = True
        state.last_move_time = time.time() - 5.0
        clocks = live_clocks(state)
        assert clocks["white"] < 600_000
        assert clocks["black"] == 600_000

    def test_clock_floored_at_zero(self, fake_game_doc):
        state = GameState(fake_game_doc)
        state.clock_running = True
        state.last_move_time = time.time() - 10_000
        clocks = live_clocks(state)
        assert clocks["white"] == 0

    def test_accepts_explicit_now_parameter(self, fake_game_doc):
        state = GameState(fake_game_doc)
        state.clock_running = True
        future_now = state.last_move_time + 10.0
        clocks = live_clocks(state, now=future_now)
        assert clocks["white"] == 600_000 - 10_000

    def test_clocks_unchanged_when_result_set(self, fake_game_doc):
        state = GameState(fake_game_doc)
        state.clock_running = True
        state.result = "white"
        state.last_move_time = time.time() - 60
        clocks = live_clocks(state)
        assert clocks["white"] == 600_000


class TestGetResult:
    def test_ongoing_game_returns_ongoing(self):
        board = chess.Board()
        assert _get_result(board) == "ongoing"

    def test_checkmate_white_wins(self):
        board = chess.Board()
        board.push_uci("f2f3")
        board.push_uci("e7e5")
        board.push_uci("g2g4")
        board.push_uci("d8h4")
        assert _get_result(board) == "black"

    def test_stalemate_is_draw(self):
        board = chess.Board("7k/5Q2/8/8/8/8/8/7K b - - 0 1")
        assert _get_result(board) == "draw"


class TestStateToDoc:
    def test_doc_contains_game_id(self, fake_game_doc):
        state = GameState(fake_game_doc)
        doc = _state_to_doc(state)
        assert doc["game_id"] == state.game_id

    def test_doc_contains_valid_fen(self, fake_game_doc):
        state = GameState(fake_game_doc)
        doc = _state_to_doc(state)
        chess.Board(doc["fen"])

    def test_doc_fen_reflects_current_position(self, fake_game_doc):
        state = GameState(fake_game_doc)
        state.board.push_uci("e2e4")
        doc = _state_to_doc(state)
        assert doc["fen"] == state.board.fen()

    def test_doc_contains_moves(self, fake_game_doc):
        state = GameState(fake_game_doc)
        state.moves = [{"uci": "e2e4"}]
        doc = _state_to_doc(state)
        assert doc["moves"] == [{"uci": "e2e4"}]

    def test_doc_contains_clocks(self, fake_game_doc):
        state = GameState(fake_game_doc)
        state.clocks["white"] = 580_000
        doc = _state_to_doc(state)
        assert doc["clocks"]["white"] == 580_000

    def test_doc_contains_result(self, fake_game_doc):
        state = GameState(fake_game_doc)
        state.result = "white"
        doc = _state_to_doc(state)
        assert doc["result"] == "white"

    def test_doc_clocks_is_independent_copy(self, fake_game_doc):
        state = GameState(fake_game_doc)
        doc = _state_to_doc(state)
        doc["clocks"]["white"] = 0
        assert state.clocks["white"] != 0
