# Tests multi-tier cascading LLM generation and tunnel management
import asyncio
import pytest
from unittest.mock import patch, AsyncMock
from llm_client import (
    get_active_kaggle_url,
    set_active_kaggle_url,
    generate_text_cascade,
)
from curriculum.heuristics import get_coaching_heuristics
from core import get_settings


# Verifies tunnel URL update and secret validation
def test_set_active_kaggle_url():
    valid = set_active_kaggle_url("https://test-tunnel-123.trycloudflare.com", "rightmove-tunnel-secret")
    assert valid is True
    assert get_active_kaggle_url() == "https://test-tunnel-123.trycloudflare.com"

    invalid = set_active_kaggle_url("https://attacker-tunnel.com", "wrong-secret")
    assert invalid is False
    assert get_active_kaggle_url() == "https://test-tunnel-123.trycloudflare.com"

    set_active_kaggle_url("", "rightmove-tunnel-secret")


# Verifies rich heuristics coverage for known and generic chess archetypes
def test_coaching_heuristics_lookup():
    rook = get_coaching_heuristics("rook_endgame_activity", "Rook Endgame Activity")
    assert "rook" in rook["concept"].lower()
    assert len(rook["signals"]) == 3
    assert len(rook["guidance"]) > 20

    king = get_coaching_heuristics("king_safety_defense", "King Safety Defense")
    assert "king" in king["concept"].lower()
    assert len(king["signals"]) == 3

    generic = get_coaching_heuristics("unknown_motif", "Unknown Pattern")
    assert len(generic["signals"]) == 3
    assert "concept" in generic


# Verifies offline-disabled path skips all LLM tiers and returns instantly
async def test_generate_text_cascade_disabled():
    with patch("llm_client.get_settings") as mock_settings:
        mock_settings.return_value.ai_explanations_enabled = False
        text, source = await generate_text_cascade("system prompt", "user query", timeout=5.0)
        assert source == "offline-disabled"
        assert text is None


# Verifies cascade returns prewritten-fallback when all tiers are mocked to fail
async def test_generate_text_cascade_all_tiers_fail():
    with patch("llm_client.get_settings") as mock_settings, \
         patch("llm_client.call_openrouter", new_callable=AsyncMock, return_value=None), \
         patch("llm_client.call_kaggle_ollama", new_callable=AsyncMock, return_value=None), \
         patch("llm_client.call_local_ollama", new_callable=AsyncMock, return_value=None):
        mock_settings.return_value.ai_explanations_enabled = True
        text, source = await generate_text_cascade("system prompt", "user query", timeout=5.0)
    assert source == "prewritten-fallback"
    assert text is None


# Verifies cascade returns result from first succeeding tier
async def test_generate_text_cascade_openrouter_wins():
    with patch("llm_client.get_settings") as mock_settings, \
         patch("llm_client.call_openrouter", new_callable=AsyncMock, return_value="OpenRouter answer"), \
         patch("llm_client.call_kaggle_ollama", new_callable=AsyncMock) as mock_kaggle, \
         patch("llm_client.call_local_ollama", new_callable=AsyncMock) as mock_local:
        mock_settings.return_value.ai_explanations_enabled = True
        text, source = await generate_text_cascade("system", "user", timeout=5.0)
        mock_kaggle.assert_not_called()
        mock_local.assert_not_called()
    assert source == "openrouter"
    assert text == "OpenRouter answer"
