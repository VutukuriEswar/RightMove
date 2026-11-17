# Tests curriculum feature extraction, clustering taxonomy, and spaced repetition algorithms
import pytest
import numpy as np
import chess
from curriculum.features import extract_features, position_difficulty, cosine_similarity
from curriculum.clustering import label_cluster, summarize_centroid, LABEL_VOCAB
from curriculum.srs import compute_health, stage_from_health
from curriculum.agent import parse_numbered_list, format_positions
from curriculum.triggers import determine_game_phase, check_agent_trigger


# Tests 32-element feature vector shape, bounds, and extraction
def test_feature_extraction_starting_board():
    board = chess.Board()
    feats = extract_features(board)
    assert isinstance(feats, np.ndarray)
    assert feats.shape == (32,)
    assert feats.dtype == np.float32
    assert 0.0 <= feats[0] <= 1.0
    assert feats[1] == 0.0
    assert feats[2] == 2.0
    assert feats[3] == 4.0
    assert feats[4] == 4.0
    assert feats[5] == 4.0
    assert feats[31] == 0.0


# Tests tactical and endgame feature extractions
def test_feature_extraction_endgame_check():
    board = chess.Board("8/8/8/4k3/8/8/4K2R/8 w - - 0 1")
    feats = extract_features(board)
    assert feats.shape == (32,)
    assert feats[24] > 0.5


# Tests tactical difficulty factor clamping and computation
def test_position_difficulty_bounds():
    board = chess.Board()
    feats = extract_features(board)
    diff = position_difficulty(feats)
    assert 0.5 <= diff <= 1.5


# Tests vector cosine similarity calculation
def test_cosine_similarity():
    v1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    v2 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    v3 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    assert pytest.approx(cosine_similarity(v1, v2)) == 1.0
    assert pytest.approx(cosine_similarity(v1, v3)) == 0.0
    assert cosine_similarity([0, 0], [0, 0]) == 0.0


# Tests cluster taxonomy labeling and fallback mechanisms
def test_cluster_labeling():
    raw_centroid = np.zeros(32, dtype=np.float32)
    raw_centroid[24] = 1.0
    raw_centroid[3] = 2.0
    key, display = label_cluster(raw_centroid)
    assert key == "rook_endgame_activity"
    assert "Rook" in display


# Tests feature summary generation from raw centroid
def test_summarize_centroid():
    raw_centroid = np.zeros(32, dtype=np.float32)
    raw_centroid[24] = 0.8
    raw_centroid[3] = 2.0
    raw_centroid[19] = 0.6
    summary = summarize_centroid(raw_centroid)
    assert summary["game_phase"] == "endgame"
    assert summary["open_files"] is True


# Tests composite health score computation and stage categorization
def test_compute_health_and_stages():
    srs_records = [
        {"interval_days": 20, "quality_history": [{"quality": 5}, {"quality": 4}]},
        {"interval_days": 16, "quality_history": [{"quality": 4}, {"quality": 5}]},
    ]
    mistakes = []
    health = compute_health("test_cluster", srs_records, mistakes)
    assert 0.0 <= health <= 100.0
    assert stage_from_health(25.0) == "Active"
    assert stage_from_health(45.0) == "Improving"
    assert stage_from_health(75.0) == "Strong"
    assert stage_from_health(90.0) == "Resolved"


# Tests parsing of numbered signal questions
def test_parse_numbered_list():
    raw = (
        "1. Is there an open file to invade?\n"
        "2. Can I place the rook behind passed pawn?\n"
        "3. Am I attacking or defending?"
    )
    res = parse_numbered_list(raw)
    assert len(res) == 3
    assert res[0] == "Is there an open file to invade?"
    assert res[1] == "Can I place the rook behind passed pawn?"
    assert res[2] == "Am I attacking or defending?"


# Tests formatting of representative position descriptions
def test_format_positions():
    positions = [
        {"fen": "8/8/8/8/8/8/8/8 w - - 0 1", "move_played": "Rd1", "best_move": "Rd7", "centipawn_loss": 120}
    ]
    txt = format_positions(positions)
    assert "Rd1" in txt
    assert "Rd7" in txt


# Tests game phase string determination from piece counts
def test_determine_game_phase():
    b_start = chess.Board()
    assert determine_game_phase(b_start) == "opening"
    b_mid = chess.Board("r1bqk2r/pp2bppp/2n1pn2/2pp4/2PP4/2N1PN2/PP2BPPP/R1BQK2R w KQkq - 4 7")
    assert determine_game_phase(b_mid) in ("opening", "middlegame")
    b_end = chess.Board("8/8/4k3/8/8/4K3/8/R7 w - - 0 1")
    assert determine_game_phase(b_end) == "endgame"


# Tests agent report trigger condition verification
def test_check_agent_trigger():
    c_low = {"mistake_count": 5}
    assert check_agent_trigger(c_low) is False
    c_high = {"mistake_count": 12, "last_reported_at": None}
    assert check_agent_trigger(c_high) is True


# Tests SRS spaced repetition update mechanics
def test_calculate_sm2_update():
    from curriculum.srs import calculate_sm2_update
    first_review = calculate_sm2_update(quality=5, reps=0, interval=1, ef=2.5, diff=1.0)
    assert first_review["interval_days"] == 1
    assert first_review["repetition_count"] == 1
    assert first_review["easiness_factor"] >= 2.5

    second_review = calculate_sm2_update(quality=4, reps=1, interval=1, ef=2.6, diff=1.0)
    assert second_review["interval_days"] == 6
    assert second_review["repetition_count"] == 2

    hard_pos = calculate_sm2_update(quality=5, reps=2, interval=6, ef=2.6, diff=1.5)
    normal_pos = calculate_sm2_update(quality=5, reps=2, interval=6, ef=2.6, diff=1.0)
    assert hard_pos["interval_days"] < normal_pos["interval_days"]

    elo_bump = calculate_sm2_update(quality=5, reps=2, interval=10, ef=2.5, diff=1.0, elo_delta=60)
    assert elo_bump["interval_days"] <= round(10 * 2.5 * 0.8)

    failure = calculate_sm2_update(quality=2, reps=3, interval=15, ef=2.5, diff=1.0)
    assert failure["interval_days"] == 1
    assert failure["repetition_count"] == 0
