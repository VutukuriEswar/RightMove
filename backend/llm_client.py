# Manages multi-tier cascading LLM generation across OpenRouter, Kaggle GPU, and local Ollama
import asyncio
import logging
import re
from typing import Optional, Tuple
import httpx
from core import get_settings

logger = logging.getLogger(__name__)

_ACTIVE_KAGGLE_TUNNEL_URL: Optional[str] = None
_LAST_GENERATION_SOURCE: str = "none"


# Formats source name for human-readable terminal display
def format_source_label(source: str) -> str:
    labels = {
        "openrouter": "OPENROUTER (Tier 1 Cloud - NVIDIA (Nemotron-3.5-Super-Vl:Free))",
        "kaggle-gpu": "KAGGLE GPU (Tier 2 Remote Ollama - Qwen2.5-7B)",
        "local-ollama": "LOCAL OLLAMA (Tier 3 Laptop CPU - Qwen2.5-7B)",
        "prewritten-fallback": "PREWRITTEN HEURISTICS (Tier 4 Grandmaster Fallback)",
        "offline-disabled": "PREWRITTEN HEURISTICS (AI Disabled in .env)",
    }
    return labels.get(source, source.upper())


# Returns short tier code for the generation source
def get_source_tier(source: str) -> str:
    tiers = {
        "openrouter": "T1",
        "kaggle-gpu": "T2",
        "local-ollama": "T3",
        "prewritten-fallback": "T4",
        "offline-disabled": "T4",
        "rule-based": "T4",
    }
    return tiers.get(source, "T4")


# Retrieves current active Kaggle Cloudflare tunnel URL
def get_active_kaggle_url() -> str:
    global _ACTIVE_KAGGLE_TUNNEL_URL
    if _ACTIVE_KAGGLE_TUNNEL_URL:
        return _ACTIVE_KAGGLE_TUNNEL_URL
    settings = get_settings()
    return (settings.kaggle_tunnel_url or "").strip().rstrip("/")


# Updates active Kaggle Cloudflare tunnel URL in memory and persists to env
def set_active_kaggle_url(url: str, secret: str = "") -> bool:
    global _ACTIVE_KAGGLE_TUNNEL_URL
    settings = get_settings()
    expected_secret = getattr(settings, "llm_tunnel_secret", "")
    if expected_secret and secret and secret != expected_secret:
        logger.warning("[llm] Unauthorized attempt to update Kaggle tunnel URL")
        return False

    cleaned = (url or "").strip().rstrip("/")
    _ACTIVE_KAGGLE_TUNNEL_URL = cleaned

    try:
        from pathlib import Path
        env_path = Path(__file__).resolve().parent / ".env"
        if env_path.exists():
            text = env_path.read_text(encoding="utf-8")
            if "KAGGLE_TUNNEL_URL=" in text:
                text = re.sub(r"KAGGLE_TUNNEL_URL=.*", f"KAGGLE_TUNNEL_URL={cleaned}", text)
            else:
                text += f"\nKAGGLE_TUNNEL_URL={cleaned}\n"
            env_path.write_text(text, encoding="utf-8")
    except Exception as e:
        logger.warning(f"[llm] Failed to persist Kaggle tunnel URL to .env: {e}")

    logger.info(f"[llm] Updated active Kaggle tunnel URL: {cleaned}")
    return True


# Ensures target Ollama model is available locally, triggering pull if missing
async def ensure_local_ollama_model(base_url: str, model_name: str) -> bool:
    try:
        clean_base = base_url.rstrip("/")
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(f"{clean_base}/api/tags")
            if res.status_code == 200:
                tags = [m.get("name", "") for m in res.json().get("models", [])]
                if any(model_name in t for t in tags):
                    return True
                logger.info(f"[llm] Model '{model_name}' missing from Ollama — triggering pull...")
                asyncio.create_task(_async_pull_ollama_model(clean_base, model_name))
                return True
    except Exception as e:
        logger.debug(f"[llm] Ollama tags check failed at {base_url}: {e}")
    return False


# Executes asynchronous background model pull for local Ollama
async def _async_pull_ollama_model(base_url: str, model_name: str):
    try:
        async with httpx.AsyncClient(timeout=1800.0) as client:
            await client.post(f"{base_url}/api/pull", json={"name": model_name, "stream": False})
            logger.info(f"[llm] Successfully pulled Ollama model '{model_name}'")
    except Exception as e:
        logger.warning(f"[llm] Failed pulling Ollama model '{model_name}': {e}")


# Queries OpenRouter chat completion API endpoint
async def call_openrouter(system: str, user: str, timeout: float = 25.0) -> Optional[str]:
    settings = get_settings()
    api_key = (settings.openrouter_api_key or "").strip()
    if not api_key:
        return None

    model = settings.openrouter_model or "nvidia/nemotron-3.5-super-vl:free"
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": "https://rightmove.chess",
        "X-Title": "RightMove Chess AI Coach",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "max_tokens": 800,
        "reasoning": {"effort": "none"},
    }

    try:
        to = httpx.Timeout(timeout=timeout, connect=min(3.0, timeout))
        async with httpx.AsyncClient(timeout=to) as client:
            res = await client.post(url, headers=headers, json=payload)
            if res.status_code == 200:
                data = res.json()
                choices = data.get("choices", [])
                if choices:
                    msg = choices[0].get("message") or {}
                    raw = msg.get("content") or choices[0].get("text") or ""
                    if not raw and msg.get("reasoning"):
                        raw = msg.get("reasoning")
                    raw_str = raw.strip() if isinstance(raw, str) else str(raw).strip()
                    content = re.sub(r"(?is)<think>.*?</think>", "", raw_str).strip()
                    if not content:
                        # Model put everything inside <think> tags (reasoning model quirk) —
                        # extract the content inside the tags rather than discarding it
                        think_match = re.search(r"(?is)<think>(.*?)</think>", raw_str)
                        if think_match:
                            content = think_match.group(1).strip()
                        # Also try the dedicated reasoning field as last resort
                        if not content and msg.get("reasoning"):
                            content = str(msg["reasoning"]).strip()
                    if content:
                        return content
            logger.warning(f"[llm] OpenRouter returned status {res.status_code}: {res.text[:150]}")
    except Exception as e:
        logger.info(f"[llm] OpenRouter request failed: {e}")
    return None


# Queries remote Kaggle Ollama GPU instance via Cloudflare tunnel
async def call_kaggle_ollama(system: str, user: str, timeout: float = 30.0) -> Optional[str]:
    tunnel_url = get_active_kaggle_url()
    if not tunnel_url:
        return None

    settings = get_settings()
    model = settings.ollama_model or "qwen2.5:7b"
    url = f"{tunnel_url}/v1/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "max_tokens": 400,
    }

    try:
        to = httpx.Timeout(timeout=timeout, connect=min(3.0, timeout))
        async with httpx.AsyncClient(timeout=to) as client:
            res = await client.post(url, json=payload)
            if res.status_code == 200:
                data = res.json()
                choices = data.get("choices", [])
                if choices:
                    msg = choices[0].get("message") or {}
                    raw = msg.get("content") or choices[0].get("text") or ""
                    if not raw and msg.get("reasoning"):
                        raw = msg.get("reasoning")
                    raw_str = raw.strip() if isinstance(raw, str) else str(raw).strip()
                    content = re.sub(r"(?is)<think>.*?</think>", "", raw_str).strip()
                    if content:
                        return content
    except Exception as e:
        logger.info(f"[llm] Kaggle tunnel request failed: {e}")
    return None


# Queries local Ollama daemon running on laptop
async def call_local_ollama(system: str, user: str, timeout: float = 60.0) -> Optional[str]:
    settings = get_settings()
    base_url = (settings.ollama_base_url or "http://127.0.0.1:11434").replace("localhost", "127.0.0.1").rstrip("/")
    model = settings.ollama_model or "qwen2.5:7b"
    url = f"{base_url}/v1/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "max_tokens": 400,
    }

    try:
        to = httpx.Timeout(timeout=timeout, connect=min(0.3, timeout))
        async with httpx.AsyncClient(timeout=to) as client:
            res = await client.post(url, json=payload)
            if res.status_code == 200:
                data = res.json()
                choices = data.get("choices", [])
                if choices:
                    msg = choices[0].get("message") or {}
                    raw = msg.get("content") or choices[0].get("text") or ""
                    if not raw and msg.get("reasoning"):
                        raw = msg.get("reasoning")
                    raw_str = raw.strip() if isinstance(raw, str) else str(raw).strip()
                    content = re.sub(r"(?is)<think>.*?</think>", "", raw_str).strip()
                    if content:
                        return content
    except Exception as e:
        logger.debug(f"[llm] Local Ollama request failed: {e}")
    return None


# Executes multi-tier cascade across OpenRouter, Kaggle GPU, and local Ollama
async def generate_text_cascade(system: str, user: str, timeout: float = 60.0) -> Tuple[Optional[str], str]:
    global _LAST_GENERATION_SOURCE
    settings = get_settings()
    if not getattr(settings, "ai_explanations_enabled", True):
        _LAST_GENERATION_SOURCE = "offline-disabled"
        logger.info("\n" + "=" * 65 + f"\n[AI COACH SOURCE] -> {format_source_label('offline-disabled')}\n" + "=" * 65)
        return None, "offline-disabled"

    out = await call_openrouter(system, user, timeout=min(25.0, timeout))
    if out:
        _LAST_GENERATION_SOURCE = "openrouter"
        logger.info("\n" + "=" * 65 + f"\n[AI COACH SOURCE] -> {format_source_label('openrouter')}\n" + "=" * 65)
        return out, "openrouter"

    out = await call_kaggle_ollama(system, user, timeout=min(25.0, timeout))
    if out:
        _LAST_GENERATION_SOURCE = "kaggle-gpu"
        logger.info("\n" + "=" * 65 + f"\n[AI COACH SOURCE] -> {format_source_label('kaggle-gpu')}\n" + "=" * 65)
        return out, "kaggle-gpu"

    out = await call_local_ollama(system, user, timeout=min(30.0, timeout))
    if out:
        _LAST_GENERATION_SOURCE = "local-ollama"
        logger.info("\n" + "=" * 65 + f"\n[AI COACH SOURCE] -> {format_source_label('local-ollama')}\n" + "=" * 65)
        return out, "local-ollama"

    _LAST_GENERATION_SOURCE = "prewritten-fallback"
    logger.info("\n" + "=" * 65 + f"\n[AI COACH SOURCE] -> {format_source_label('prewritten-fallback')}\n" + "=" * 65)
    return None, "prewritten-fallback"
