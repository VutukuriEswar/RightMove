import pytest
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from review import (
    eval_to_win_prob,
    accuracy_from_wp_diff,
    classify_loss,
    classify_move,
    game_accuracy,
    color_accuracy,
    count_labels,
    grade_for,
    accuracy_from_classifications,
)


class TestEvalToWinProb:
    def test_zero_centipawns_returns_fifty_percent(self):
        assert eval_to_win_prob(0) == pytest.approx(0.5, abs=0.001)

    def test_large_positive_advantage_near_one(self):
        prob = eval_to_win_prob(2000)
        assert prob > 0.99

    def test_large_negative_advantage_near_zero(self):
        prob = eval_to_win_prob(-2000)
        assert prob < 0.01

    def test_positive_advantage_above_half(self):
        assert eval_to_win_prob(100) > 0.5

    def test_negative_advantage_below_half(self):
        assert eval_to_win_prob(-100) < 0.5

    def test_clamps_above_plus_2000(self):
        assert eval_to_win_prob(9999) == eval_to_win_prob(2000)

    def test_clamps_below_minus_2000(self):
        assert eval_to_win_prob(-9999) == eval_to_win_prob(-2000)

    def test_returns_float(self):
        assert isinstance(eval_to_win_prob(50), float)

    def test_handles_string_input_gracefully(self):
        result = eval_to_win_prob("0")
        assert result == pytest.approx(0.5, abs=0.001)

    def test_handles_none_as_zero(self):
        result = eval_to_win_prob(None)
        assert result == pytest.approx(0.5, abs=0.001)


class TestAccuracyFromWpDiff:
    def test_zero_diff_gives_max_accuracy(self):
        result = accuracy_from_wp_diff(0.5, 0.5)
        assert result == pytest.approx(100.0, abs=1.0)

    def test_large_diff_gives_low_accuracy(self):
        result = accuracy_from_wp_diff(0.9, 0.5)
        result2 = accuracy_from_wp_diff(0.5, 0.9)
        assert result < result2

    def test_result_clamped_between_zero_and_hundred(self):
        result = accuracy_from_wp_diff(1.0, 0.0)
        assert 0.0 <= result <= 100.0

    def test_negative_diff_treated_as_zero(self):
        result_zero = accuracy_from_wp_diff(0.5, 0.5)
        result_negative = accuracy_from_wp_diff(0.4, 0.6)
        assert result_negative >= result_zero - 1.0


class TestClassifyLoss:
    def test_zero_loss_is_best(self):
        assert classify_loss(0.0) == "best"

    def test_is_best_flag_forces_best(self):
        assert classify_loss(500.0, is_best=True) == "best"

    def test_tiny_loss_is_best(self):
        assert classify_loss(15.0) == "best"

    def test_small_loss_is_excellent(self):
        assert classify_loss(30.0) == "excellent"

    def test_medium_loss_is_good(self):
        assert classify_loss(80.0) == "good"

    def test_larger_loss_is_inaccuracy(self):
        assert classify_loss(150.0) == "inaccuracy"

    def test_big_loss_is_mistake(self):
        assert classify_loss(300.0) == "mistake"

    def test_huge_loss_is_blunder(self):
        assert classify_loss(500.0) == "blunder"

    def test_capture_sac_is_brilliant(self):
        assert classify_loss(300.0, is_capture_sac=True) == "brilliant"

    def test_handles_none_loss(self):
        result = classify_loss(None)
        assert result == "best"


class TestClassifyMove:
    def test_equal_evals_white_to_move_is_best(self):
        result = classify_move(0, 0, is_white_to_move=True)
        assert result in ("best", "excellent", "good")

    def test_massive_drop_white_is_blunder(self):
        result = classify_move(400, -400, is_white_to_move=True)
        assert result == "blunder"

    def test_massive_drop_black_is_blunder(self):
        result = classify_move(-400, 400, is_white_to_move=False)
        assert result == "blunder"

    def test_small_drop_white_is_good_or_better(self):
        result = classify_move(50, 30, is_white_to_move=True)
        assert result in ("best", "excellent", "good")

    def test_handles_none_evals(self):
        result = classify_move(None, None, is_white_to_move=True)
        assert result in ("best", "excellent", "good", "inaccuracy", "mistake", "blunder")

    def test_white_losing_move_classified_worse_than_holding(self):
        good = classify_move(100, 90, is_white_to_move=True)
        bad = classify_move(100, -200, is_white_to_move=True)
        rank = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"]
        assert rank.index(bad) > rank.index(good)


class TestGameAccuracy:
    def test_empty_list_returns_zero(self):
        assert game_accuracy([]) == 0.0

    def test_all_hundred_returns_hundred(self):
        assert game_accuracy([100.0, 100.0, 100.0]) == 100.0

    def test_mixed_returns_average(self):
        assert game_accuracy([80.0, 60.0]) == pytest.approx(70.0, abs=0.1)

    def test_ignores_nan_values(self):
        import math
        result = game_accuracy([100.0, math.nan])
        assert result == 100.0

    def test_single_value_returns_itself(self):
        assert game_accuracy([55.5]) == pytest.approx(55.5, abs=0.1)


class TestGradeFor:
    def test_perfect_accuracy_is_grandmaster(self):
        label = grade_for(100.0)
        assert label is not None and len(label) > 0

    def test_low_accuracy_gives_lower_grade(self):
        high = grade_for(95.0)
        low = grade_for(40.0)
        assert high != low

    def test_zero_accuracy_does_not_raise(self):
        grade_for(0.0)


class TestCountLabels:
    def test_counts_blunders(self):
        moves = [{"classification": "blunder"}, {"classification": "blunder"}, {"classification": "best"}]
        result = count_labels(moves)
        assert result["blunder"] == 2
        assert result["best"] == 1

    def test_empty_list_all_zero(self):
        result = count_labels([])
        assert all(v == 0 for v in result.values())

    def test_ignores_unknown_labels(self):
        result = count_labels([{"classification": "unknown_label"}])
        assert result["good"] == 1


class TestAccuracyFromClassifications:
    def test_empty_returns_hundred(self):
        from engines import accuracy_from_classifications
        assert accuracy_from_classifications([]) == 100.0

    def test_all_blunders_returns_zero(self):
        from engines import accuracy_from_classifications
        assert accuracy_from_classifications(["blunder", "blunder"]) == 0.0

    def test_all_best_returns_hundred(self):
        from engines import accuracy_from_classifications
        assert accuracy_from_classifications(["best", "best"]) == 100.0

    def test_mixed_returns_weighted_average(self):
        from engines import accuracy_from_classifications
        result = accuracy_from_classifications(["best", "blunder"])
        assert 0.0 < result < 100.0

    def test_unknown_label_treated_as_good(self):
        from engines import accuracy_from_classifications
        result = accuracy_from_classifications(["unknown_label"])
        assert result == pytest.approx(75.0, abs=0.1)
