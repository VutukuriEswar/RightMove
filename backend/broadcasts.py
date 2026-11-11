# Provides free live chess broadcasts from Lichess and local Stockfish analysis
import asyncio
import base64
import io
import json
import logging
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import chess
import chess.engine
import chess.pgn
import httpx

from core import get_db, get_settings
from review import accuracy_from_wp_diff, classify_loss, eval_to_win_prob

logger = logging.getLogger(__name__)
settings = get_settings()

LICHESS_BASE = "https://lichess.org"
ID_RE = re.compile(r"^[A-Za-z0-9]{8}$")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,140}$")

BACKEND_DIR = Path(__file__).resolve().parent


# Defines exception raised for upstream broadcast failures
class BroadcastError(Exception):
    pass


# Section broadcasts/cache

# Manages in-memory TTL caching with size-bounded eviction
class _TTLCache:
    def __init__(self):
        self._data: dict[str, tuple[float, object]] = {}

    def get(self, key: str, ttl: float):
        item = self._data.get(key)
        if not item:
            return None
        stored_at, value = item
        if time.monotonic() - stored_at > ttl:
            return None
        return value

    def get_stale(self, key: str):
        item = self._data.get(key)
        return item[1] if item else None

    def set(self, key: str, value):
        self._data[key] = (time.monotonic(), value)
        if len(self._data) > 400:
            oldest = sorted(self._data.items(), key=lambda kv: kv[1][0])[:100]
            for k, _ in oldest:
                self._data.pop(k, None)


_cache = _TTLCache()
_key_locks: dict[str, asyncio.Lock] = {}
_key_locks_guard = asyncio.Lock()


# Acquires per-key asyncio lock for deduplicated fetching
async def _lock_for(key: str) -> asyncio.Lock:
    async with _key_locks_guard:
        lock = _key_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _key_locks[key] = lock
        return lock


# Returns cached value or evaluates factory coroutine
async def _cached(key: str, ttl: float, factory):
    hit = _cache.get(key, ttl)
    if hit is not None:
        return hit
    lock = await _lock_for(key)
    async with lock:
        hit = _cache.get(key, ttl)
        if hit is not None:
            return hit
        try:
            value = await factory()
        except Exception:
            stale = _cache.get_stale(key)
            if stale is not None:
                logger.warning("[broadcasts] upstream failed; serving stale cache for %s", key)
                return stale
            raise
        _cache.set(key, value)
        return value


# Section broadcasts/client

_client: Optional[httpx.AsyncClient] = None


# Returns shared HTTP client configured for Lichess
def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        headers = {
            "User-Agent": "RightMove/1.0 (free chess training app; broadcast viewer)",
            "Accept": "application/json",
        }
        token = (settings.lichess_token or "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        _client = httpx.AsyncClient(
            base_url=LICHESS_BASE,
            headers=headers,
            timeout=httpx.Timeout(20.0, connect=10.0),
            follow_redirects=True,
        )
    return _client


# Closes shared Lichess HTTP client session
async def close_broadcast_client():
    global _client
    if _client is not None:
        try:
            await _client.aclose()
        except Exception:
            pass
        _client = None


# Sends GET request to Lichess with retry logic
async def _get(path: str, *, accept: Optional[str] = None) -> str:
    headers = {"Accept": accept} if accept else None
    last_error: Optional[Exception] = None
    for attempt in range(3):
        try:
            res = await _http().get(path, headers=headers)
            if res.status_code == 429:
                retry_after = res.headers.get("Retry-After")
                wait = float(retry_after) if retry_after and retry_after.isdigit() else 2.0 * (attempt + 1)
                logger.warning("[broadcasts] Lichess rate limit on %s; waiting %.1fs", path, wait)
                await asyncio.sleep(wait)
                continue
            if res.status_code >= 400:
                raise BroadcastError(f"Lichess returned HTTP {res.status_code} for {path}")
            return res.text
        except BroadcastError:
            raise
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                await asyncio.sleep(1.0 * (attempt + 1))
    raise BroadcastError(f"Could not reach Lichess: {last_error}")


# Sends GET request and parses JSON response
async def _get_json(path: str):
    text = await _get(path, accept="application/json")
    try:
        return json.loads(text)
    except Exception as exc:
        raise BroadcastError(f"Invalid JSON from Lichess: {exc}")


# Parses newline-delimited JSON stream
def _parse_ndjson(text: str) -> list[dict]:
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


# Converts millisecond timestamp to ISO string
def _ms_iso(value) -> Optional[str]:
    try:
        return datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc).isoformat()
    except Exception:
        return None


# Validates 8-character alphanumeric identifier
def _validate_id(value: str, name: str = "id") -> str:
    if not value or not ID_RE.fullmatch(value):
        raise BroadcastError(f"Invalid broadcast {name}")
    return value


# Validates tournament slug format
def _validate_slug(value: str, name: str = "slug") -> str:
    if not value or not SLUG_RE.fullmatch(value):
        raise BroadcastError(f"Invalid broadcast {name}")
    return value


# Section broadcasts/normalisation

# Normalizes round metadata dictionary
def _norm_round(round_doc: Optional[dict]) -> Optional[dict]:
    if not round_doc:
        return None
    return {
        "id": round_doc.get("id"),
        "name": round_doc.get("name") or "Round",
        "slug": round_doc.get("slug"),
        "starts_at": _ms_iso(round_doc.get("startsAt")),
        "ongoing": bool(round_doc.get("ongoing")),
        "url": round_doc.get("url"),
    }


# Normalizes tournament event metadata
def _norm_event(tour: dict, active_round: Optional[dict] = None, group=None,
                rounds: Optional[list] = None) -> dict:
    info = tour.get("info") or {}
    norm_rounds = [_norm_round(r) for r in (rounds or tour.get("rounds") or []) if r]
    norm_active = _norm_round(active_round) if active_round else None
    if norm_active is None:
        norm_active = next((r for r in norm_rounds if r.get("ongoing")), None)
    if norm_active is None and norm_rounds:
        norm_active = norm_rounds[-1]

    now = datetime.now(timezone.utc)
    starts = None
    if norm_active and norm_active.get("starts_at"):
        try:
            starts = datetime.fromisoformat(norm_active["starts_at"])
        except Exception:
            starts = None

    is_live = bool(norm_active and norm_active.get("ongoing"))
    is_upcoming = bool(starts and starts > now and not is_live)
    is_finished = bool(starts and starts <= now and not is_live)

    return {
        "id": tour.get("id"),
        "name": tour.get("name") or "Chess event",
        "slug": tour.get("slug"),
        "tier": int(tour.get("tier") or 0),
        "image": tour.get("image"),
        "url": tour.get("url"),
        "format": info.get("format"),
        "time_control": info.get("tc"),
        "fide_tc": info.get("fideTC"),
        "location": info.get("location"),
        "timezone": info.get("timeZone"),
        "website": info.get("website"),
        "regulations": info.get("regulations"),
        "standings": info.get("standings"),
        "dates": [_ms_iso(d) for d in (tour.get("dates") or [])],
        "group": group,
        "rounds": norm_rounds,
        "active_round": norm_active,
        "is_live": is_live,
        "is_upcoming": is_upcoming,
        "is_finished": is_finished,
    }


# Determines game result string from status
def _game_result(status: Optional[str]) -> str:
    status = (status or "").strip()
    if status in ("1-0", "0-1", "½-½", "1/2-1/2"):
        return status
    return "*"


# Normalizes player clock value from Lichess centiseconds to milliseconds
def _norm_clock_ms(value) -> Optional[int]:
    if value is None:
        return None
    try:
        return max(0, int(value) * 10)
    except (TypeError, ValueError):
        return None


# Returns player avatar photo URL if available
def _player_avatar_url(name: str, fide_id: Optional[str] = None) -> Optional[str]:
    fid = (fide_id or "").strip()
    if fid and fid.isdigit():
        return f"/broadcasts/player-avatar/{fid}"
    clean = re.sub(r"[^a-zA-Z\s]", "", (name or "")).lower()
    famous = {
        "carlsen": "1503014",
        "nakamura": "2016192",
        "gukesh": "46616543",
        "caruana": "2020009",
        "nepomniachtchi": "4168119",
        "firouzja": "12573981",
        "erigaisi": "35009192",
        "abdusattorov": "14204118",
        "ding": "8603677",
        "wei yi": "8603405",
        "anand": "5000017",
        "praggnanandhaa": "25059530",
        "vidit": "5026694",
        "so": "5200219",
        "aronian": "13300474",
        "giri": "24116068",
        "vachier lagrave": "623539",
        "duda": "1170546",
        "keymer": "12940690",
        "rapport": "738590",
        "dubov": "24126055",
        "niemann": "2093596",
        "maghsoodloo": "12539929",
        "tabatabaei": "12521213",
        "mamedyarov": "13401319",
        "grischuk": "4126025",
        "radjabov": "13400924",
        "karjakin": "14109603",
        "svidler": "4102142",
        "kasparov": "4100018",
        "kramnik": "4101588",
        "fischer": "2000013",
        "tal": "4100026",
        "spassky": "4100034",
        "petrosian": "4100042",
        "smyslov": "4100050",
        "botvinnik": "4100069",
        "ju wenjun": "8603006",
        "lei tingjie": "8605114",
        "humpy": "5006885",
        "goryachkina": "4147103",
        "hou yifan": "8602883",
        "deshmukh": "35015095",
        "agrawal": "35008544",
        "dronavalli": "5015197",
        "vaishali": "25072782",
        "kosteniuk": "4128125",
        "muzychuk": "14111330",
        "tan zhongyi": "8603642",
    }
    for key, fid_match in famous.items():
        if key in clean:
            return f"/broadcasts/player-avatar/{fid_match}"
    return None


_avatar_cache: dict[str, Optional[bytes]] = {}
_avatar_lock = asyncio.Lock()


# Fetches and caches player profile photo image bytes from FIDE
async def get_player_avatar(fide_id: str) -> tuple[Optional[bytes], str]:
    fide_id = (fide_id or "").strip()
    if not fide_id.isdigit():
        return None, "image/jpeg"
    if fide_id in _avatar_cache:
        data = _avatar_cache[fide_id]
        if not data:
            return None, "image/jpeg"
        media = "image/png" if data.startswith(b"\x89PNG") else "image/jpeg"
        return data, media

    try:
        db = get_db()
        doc = await db.broadcast_player_avatars.find_one({"fide_id": fide_id})
        if doc and doc.get("image_bytes"):
            data = bytes(doc["image_bytes"])
            _avatar_cache[fide_id] = data
            media = "image/png" if data.startswith(b"\x89PNG") else "image/jpeg"
            return data, media
        if doc and doc.get("not_found"):
            _avatar_cache[fide_id] = None
            return None, "image/jpeg"
    except Exception:
        pass

    async with _avatar_lock:
        if fide_id in _avatar_cache:
            data = _avatar_cache[fide_id]
            if not data:
                return None, "image/jpeg"
            media = "image/png" if data.startswith(b"\x89PNG") else "image/jpeg"
            return data, media
        try:
            url = f"https://ratings.fide.com/profile/{fide_id}"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            }
            client = _http()
            resp = await client.get(url, headers=headers, timeout=8.0, follow_redirects=True)
            if resp.status_code == 200:
                m = re.search(r'<img[^>]+class="profile-top__photo"[^>]+src="data:image/[^;]+;base64,([^"]+)"', resp.text)
                if not m:
                    m = re.search(r'<img[^>]+src="data:image/[^;]+;base64,([^"]+)"[^>]+class="profile-top__photo"', resp.text)
                if m:
                    raw_b64 = m.group(1)
                    img_bytes = base64.b64decode(raw_b64)
                    _avatar_cache[fide_id] = img_bytes
                    media = "image/png" if img_bytes.startswith(b"\x89PNG") else "image/jpeg"
                    try:
                        db = get_db()
                        await db.broadcast_player_avatars.update_one(
                            {"fide_id": fide_id},
                            {"$set": {"fide_id": fide_id, "image_bytes": img_bytes, "updated_at": datetime.now(timezone.utc)}},
                            upsert=True,
                        )
                    except Exception:
                        pass
                    return img_bytes, media

            _avatar_cache[fide_id] = None
            try:
                db = get_db()
                await db.broadcast_player_avatars.update_one(
                    {"fide_id": fide_id},
                    {"$set": {"fide_id": fide_id, "not_found": True, "updated_at": datetime.now(timezone.utc)}},
                    upsert=True,
                )
            except Exception:
                pass
            return None, "image/jpeg"
        except Exception as exc:
            logger.warning("[broadcasts] could not fetch FIDE avatar for %s: %s", fide_id, exc)
            return None, "image/jpeg"


# Normalizes individual broadcast game dictionary
def _norm_game(game: dict, tour: dict, round_doc: dict) -> dict:
    players = game.get("players") or []
    white = players[0] if len(players) > 0 else {}
    black = players[1] if len(players) > 1 else {}
    tour_slug = tour.get("slug")
    round_slug = round_doc.get("slug")
    round_id = round_doc.get("id")
    game_id = game.get("id")
    url = None
    if tour_slug and round_slug and round_id and game_id:
        url = f"{LICHESS_BASE}/broadcast/{tour_slug}/{round_slug}/{round_id}/{game_id}"

    white_name = white.get("name") or "White"
    black_name = black.get("name") or "Black"
    white_fide = str(white.get("fideId") or "").strip() or None
    black_fide = str(black.get("fideId") or "").strip() or None

    return {
        "id": game_id,
        "name": game.get("name") or f"{white_name} - {black_name}",
        "white": white_name,
        "black": black_name,
        "white_title": white.get("title"),
        "black_title": black.get("title"),
        "white_rating": white.get("rating"),
        "black_rating": black.get("rating"),
        "white_fed": white.get("fed"),
        "black_fed": black.get("fed"),
        "white_fide_id": white_fide,
        "black_fide_id": black_fide,
        "white_avatar": _player_avatar_url(white_name, white_fide),
        "black_avatar": _player_avatar_url(black_name, black_fide),
        "white_clock_ms": _norm_clock_ms(white.get("clock")),
        "black_clock_ms": _norm_clock_ms(black.get("clock")),
        "fen": game.get("fen") or chess.STARTING_FEN,
        "last_move": game.get("lastMove"),
        "status": game.get("status") or "*",
        "result": _game_result(game.get("status")),
        "url": url,
    }


# Normalizes round detail dictionary with games and event metadata
def _norm_round_detail(data: dict) -> dict:
    tour = data.get("tour") or {}
    round_doc = data.get("round") or {}
    event = _norm_event(tour, active_round=round_doc, group=data.get("group"))
    games = [_norm_game(g, tour, round_doc) for g in (data.get("games") or [])]
    return {
        "id": round_doc.get("id"),
        "name": round_doc.get("name") or "Round",
        "slug": round_doc.get("slug"),
        "starts_at": _ms_iso(round_doc.get("startsAt")),
        "ongoing": bool(round_doc.get("ongoing")),
        "url": round_doc.get("url"),
        "event": event,
        "games": games,
        "game_count": len(games),
        "finished": bool(games) and all(g["result"] != "*" for g in games),
    }


# Section broadcasts/helpers

# Fetches top active upcoming and recent broadcasts
async def list_top(page: int = 1) -> dict:
    page = max(1, min(int(page or 1), 20))

    async def _fetch():
        data = await _get_json(f"/api/broadcast/top?page={page}")
        active = []
        for item in data.get("active") or []:
            if not isinstance(item, dict):
                continue
            tour = item.get("tour") or {}
            active.append(_norm_event(tour, active_round=item.get("round"), group=item.get("group")))
        upcoming = []
        for item in data.get("upcoming") or []:
            if not isinstance(item, dict):
                continue
            tour = item.get("tour") or {}
            upcoming.append(_norm_event(tour, active_round=item.get("round"), group=item.get("group")))
        raw_past = data.get("past") or []
        if isinstance(raw_past, dict):
            raw_past = raw_past.get("currentPageResults") or []
        past = []
        for item in raw_past:
            if not isinstance(item, dict):
                continue
            tour = item.get("tour") or {}
            past.append(_norm_event(tour, active_round=item.get("round"), group=item.get("group")))
        return {"active": active, "upcoming": upcoming, "past": past, "page": page}

    return await _cached(f"top:{page}", 30.0, _fetch)


# Fetches ongoing live broadcasts
async def list_live(nb: int = 20) -> list[dict]:
    nb = max(1, min(int(nb or 20), 50))

    async def _fetch():
        text = await _get(
            f"/api/broadcast?live=true&nb={nb}",
            accept="application/x-ndjson",
        )
        items = _parse_ndjson(text)
        out = []
        for item in items:
            tour = item.get("tour") or {}
            rounds = item.get("rounds") or []
            active = next((r for r in rounds if r.get("ongoing")), None)
            if active is None and rounds:
                active = rounds[-1]
            out.append(_norm_event(tour, active_round=active, group=item.get("group"), rounds=rounds))
        return out

    return await _cached(f"live:{nb}", 15.0, _fetch)


# Searches broadcasts directly on Lichess with multi-page querying and URL slug resolution
async def search_events(query: str) -> list[dict]:
    clean = (query or "").strip()
    if not clean:
        return []
    clean = clean[:120]

    async def _fetch():
        direct_tour = None
        url_m = re.search(r"lichess\.org/broadcast/([^/?#]+)", clean)
        slug_or_id = url_m.group(1) if url_m else clean
        search_term = slug_or_id.replace("-", " ") if ("-" in slug_or_id or url_m) else clean

        if ID_RE.fullmatch(slug_or_id):
            try:
                data = await _get_json(f"/api/broadcast/{slug_or_id}")
                tour = data.get("tour") or {}
                rounds = data.get("rounds") or []
                active = next((r for r in rounds if r.get("ongoing")), None)
                if active is None and rounds:
                    active = rounds[-1]
                direct_tour = _norm_event(tour, active_round=active, group=data.get("group"), rounds=rounds)
            except Exception:
                pass

        async def _fetch_page(page_num: int):
            try:
                params = httpx.QueryParams({"q": search_term, "page": page_num})
                data = await _get_json(f"/api/broadcast/search?{params}")
                return data.get("currentPageResults") or []
            except Exception:
                return []

        page_tasks = [_fetch_page(p) for p in (1, 2, 3, 4)]
        pages_results = await asyncio.gather(*page_tasks)
        raw_items = []
        for res in pages_results:
            raw_items.extend(res)

        seen = set()
        out = []
        if direct_tour and direct_tour.get("id"):
            seen.add(direct_tour["id"])
            out.append(direct_tour)

        for item in raw_items:
            tour = item.get("tour") or {}
            tid = tour.get("id")
            if not tid or tid in seen:
                continue
            seen.add(tid)
            out.append(_norm_event(tour, active_round=item.get("round")))

        q_lower = search_term.lower()
        q_words = [w for w in q_lower.split() if len(w) >= 2]

        def _rank(event: dict) -> int:
            score = 0
            name = (event.get("name") or "").lower()
            slug = (event.get("slug") or "").lower()
            tier = int(event.get("tier") or 0)
            score += tier * 20
            if "world championship" in name or "world-championship" in slug:
                score += 150
            if "candidates" in name:
                score += 100
            if slug == slug_or_id.lower() or name == q_lower:
                score += 1000
            elif q_lower in name or q_lower in slug:
                score += 500
            else:
                for w in q_words:
                    if len(w) >= 3 and (w in name or w in slug):
                        score += 40
            return score

        out.sort(key=_rank, reverse=True)
        return out

    return await _cached(f"search:{clean.lower()}", 60.0, _fetch)


# Resolves broadcast tournament identifier from ID or slug
async def _resolve_tournament_id(tour_id: str) -> str:
    clean_id = (tour_id or "").strip()
    if not clean_id:
        raise BroadcastError("Missing tournament identifier")
    if ID_RE.fullmatch(clean_id):
        return clean_id
    if SLUG_RE.fullmatch(clean_id):
        found = await search_events(clean_id.replace("-", " "))
        match = next((t for t in found if t.get("slug") == clean_id or t.get("id") == clean_id), None)
        if match and match.get("id"):
            return match["id"]
        if found and found[0].get("id"):
            return found[0]["id"]
    raise BroadcastError(f"Broadcast tournament '{tour_id}' not found")


# Fetches tournament details and round schedule
async def get_tournament(tour_id: str) -> dict:
    clean_id = await _resolve_tournament_id(tour_id)

    async def _fetch():
        try:
            data = await _get_json(f"/api/broadcast/{clean_id}")
        except Exception:
            if ID_RE.fullmatch(clean_id):
                try:
                    pgn_text = await get_round_pgn(clean_id)
                    site_m = re.search(r'\[Site\s+"https?://lichess\.org/broadcast/([^/"]+)/', pgn_text or "")
                    if site_m:
                        resolved_id = await _resolve_tournament_id(site_m.group(1))
                        data = await _get_json(f"/api/broadcast/{resolved_id}")
                    else:
                        raise BroadcastError(f"Tournament {clean_id} not found")
                except Exception:
                    raise BroadcastError(f"Tournament {clean_id} not found")
            else:
                raise BroadcastError(f"Tournament {clean_id} not found")

        tour = data.get("tour") or {}
        rounds = data.get("rounds") or []
        default_id = data.get("defaultRoundId")
        active = next((r for r in rounds if r.get("id") == default_id), None)
        if active is None:
            active = next((r for r in rounds if r.get("ongoing")), None)
        event = _norm_event(tour, active_round=active, group=data.get("group"), rounds=rounds)
        event["default_round_id"] = default_id
        return event

    return await _cached(f"tour:{clean_id}", 45.0, _fetch)


# Fetches round details and current game states
async def get_round(tour_id: str, round_id: str) -> dict:
    round_id = _validate_id(round_id, "round id")

    async def _fetch():
        event = await get_tournament(tour_id)
        resolved_tour_id = event.get("id")
        round_meta = next((r for r in event.get("rounds") or [] if r.get("id") == round_id), None)
        if round_meta is None:
            raise BroadcastError("Round not found in this tournament")
        tour_slug = _validate_slug(event.get("slug"), "tournament slug")
        round_slug = _validate_slug(round_meta.get("slug"), "round slug")
        data = await _get_json(f"/api/broadcast/{tour_slug}/{round_slug}/{round_id}")
        detail = _norm_round_detail(data)
        detail["event"] = event
        await _enrich_games_with_pgn(round_id, detail.get("games") or [])
        await _check_and_enqueue_live_updates(resolved_tour_id, round_id, detail.get("games") or [])
        return detail

    return await _cached(f"round:{tour_id}:{round_id}", 10.0, _fetch)


# Downloads raw PGN text for a broadcast round
async def get_round_pgn(round_id: str) -> str:
    round_id = _validate_id(round_id, "round id")

    async def _fetch():
        return await _get(
            f"/api/broadcast/round/{round_id}.pgn?clocks=true&comments=true",
            accept="application/x-chess-pgn",
        )

    return await _cached(f"pgn:{round_id}", 20.0, _fetch)


# Extracts game identifier from PGN game headers
def _pgn_game_id(game: chess.pgn.Game) -> Optional[str]:
    url = game.headers.get("GameURL") or game.headers.get("Site") or ""
    path = url.split("?")[0].split("#")[0].rstrip("/")
    match = re.search(r"/([A-Za-z0-9]{8})$", path)
    return match.group(1) if match else None


# Parses clock string formatted as H:MM:SS or MM:SS to milliseconds
def _parse_clock_str_ms(clock_str: str) -> Optional[int]:
    if not clock_str or not isinstance(clock_str, str):
        return None
    parts = clock_str.strip().split(":")
    try:
        nums = [int(p) for p in parts]
        if len(nums) == 3:
            return (nums[0] * 3600 + nums[1] * 60 + nums[2]) * 1000
        if len(nums) == 2:
            return (nums[0] * 60 + nums[1]) * 1000
    except (ValueError, TypeError):
        return None
    return None


# Extracts full ply sequence from PGN game with clocks and evaluations
def _extract_pgn_moves(game: chess.pgn.Game) -> list[dict]:
    board = game.board()
    moves = []
    ply = 0
    for node in game.mainline():
        move = node.move
        if not move:
            continue
        try:
            san = board.san(move)
        except Exception:
            san = node.san() if hasattr(node, "san") else str(move)
        uci = move.uci()
        is_white = board.turn == chess.WHITE
        comment = (node.comment or "").strip()
        clk_match = re.search(r"\[%clk\s+([0-9:]+)\]", comment)
        clock_str = clk_match.group(1) if clk_match else None

        eval_match = re.search(r"\[%eval\s+([+-]?[0-9.]+|#[+-]?[0-9]+)\]", comment)
        eval_cp = None
        if eval_match:
            raw_v = eval_match.group(1)
            try:
                if raw_v.startswith("#"):
                    m_val = int(raw_v.replace("#", ""))
                    eval_cp = 10000 if m_val > 0 else -10000
                else:
                    eval_cp = int(round(float(raw_v) * 100))
            except Exception:
                eval_cp = None

        classification = None
        if san.endswith("??") or re.search(r"\bblunder\b", comment, re.I):
            classification = "blunder"
        elif san.endswith("?!") or re.search(r"\binaccuracy\b", comment, re.I):
            classification = "inaccuracy"
        elif san.endswith("?") or re.search(r"\bmistake\b", comment, re.I):
            classification = "mistake"
        elif san.endswith("!") or re.search(r"\bbest\b", comment, re.I):
            classification = "best"

        best_match = re.search(r"(?:Inaccuracy|Mistake|Blunder)\.\s+([A-Za-z0-9+#=]+)\s+was\s+best", comment, re.I)
        best_san = best_match.group(1) if best_match else None
        clean_comment = re.sub(r"\[%(?:clk|eval|emt)[^\]]*\]", "", comment).strip()
        clean_comment = re.sub(r"\s+", " ", clean_comment).strip() or None

        try:
            board.push(move)
        except Exception:
            try:
                board.push_uci(uci)
            except Exception:
                try:
                    board.push_san(san)
                except Exception:
                    pass
        ply += 1
        moves.append({
            "ply": ply,
            "move_number": (ply + 1) // 2,
            "turn": "white" if is_white else "black",
            "san": san,
            "uci": uci,
            "is_white": is_white,
            "fen_after": board.fen(),
            "clock_str": clock_str,
            "eval_after_cp": eval_cp,
            "classification": classification,
            "best_move_san": best_san,
            "comment": clean_comment,
        })
    return moves


# Enriches round games list with full moves parsed from round PGN
async def _enrich_games_with_pgn(round_id: str, games: list[dict]):
    if not games or not round_id:
        return
    try:
        pgn_text = await get_round_pgn(round_id)
        if not pgn_text:
            return
        stream = io.StringIO(pgn_text)
        pgn_games_by_id: dict[str, chess.pgn.Game] = {}
        pgn_games_list: list[chess.pgn.Game] = []
        while True:
            try:
                g = chess.pgn.read_game(stream)
            except Exception:
                break
            if g is None:
                break
            gid = _pgn_game_id(g)
            if gid:
                pgn_games_by_id[gid] = g
            pgn_games_list.append(g)

        for idx, game in enumerate(games):
            gid = game.get("id")
            pgn_g = pgn_games_by_id.get(gid)
            if pgn_g is None and idx < len(pgn_games_list):
                pgn_g = pgn_games_list[idx]
            if pgn_g is not None:
                moves = _extract_pgn_moves(pgn_g)
                game["moves"] = moves
                if moves:
                    game["fen"] = moves[-1]["fen_after"]
                    game["last_move"] = moves[-1]["uci"]
                eco = pgn_g.headers.get("ECO")
                opening = pgn_g.headers.get("Opening")
                pgn_res = pgn_g.headers.get("Result")
                w_fide = pgn_g.headers.get("WhiteFideId")
                b_fide = pgn_g.headers.get("BlackFideId")
                if eco:
                    game["eco"] = eco
                if opening:
                    game["opening"] = opening
                if pgn_res and pgn_res in ("1-0", "0-1", "1/2-1/2"):
                    game["result"] = pgn_res
                if w_fide and not game.get("white_fide_id"):
                    game["white_fide_id"] = str(w_fide).strip()
                    game["white_avatar"] = _player_avatar_url(game.get("white"), game["white_fide_id"])
                if b_fide and not game.get("black_fide_id"):
                    game["black_fide_id"] = str(b_fide).strip()
                    game["black_avatar"] = _player_avatar_url(game.get("black"), game["black_fide_id"])
                w_clk = None
                b_clk = None
                for m in moves:
                    if m.get("clock_str"):
                        if m.get("is_white"):
                            w_clk = m["clock_str"]
                        else:
                            b_clk = m["clock_str"]
                if w_clk:
                    game["white_clock_str"] = w_clk
                    ms = _parse_clock_str_ms(w_clk)
                    if ms is not None:
                        game["white_clock_ms"] = ms
                if b_clk:
                    game["black_clock_str"] = b_clk
                    ms = _parse_clock_str_ms(b_clk)
                    if ms is not None:
                        game["black_clock_ms"] = ms
    except Exception as exc:
        logger.debug("[broadcasts] could not enrich games with PGN: %s", exc)


# Section broadcasts/queue

# Upserts tracked tournament record in database
async def track_tour(event: dict):
    tour_id = event.get("id")
    if not tour_id:
        return
    try:
        db = get_db()
        now = datetime.now(timezone.utc)
        await db.broadcast_tracked_tours.update_one(
            {"tour_id": tour_id},
            {
                "$set": {
                    "tour_id": tour_id,
                    "name": event.get("name"),
                    "slug": event.get("slug"),
                    "last_seen": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
    except Exception as exc:
        logger.debug("[broadcasts] could not track tour: %s", exc)


# Upserts batch of tracked tournament records
async def track_events(events: list[dict]):
    from pymongo import UpdateOne

    now = datetime.now(timezone.utc)
    ops = []
    for event in events or []:
        tour_id = event.get("id")
        if not tour_id:
            continue
        ops.append(
            UpdateOne(
                {"tour_id": tour_id},
                {
                    "$set": {
                        "tour_id": tour_id,
                        "name": event.get("name"),
                        "slug": event.get("slug"),
                        "last_seen": now,
                    },
                    "$setOnInsert": {"created_at": now},
                },
                upsert=True,
            )
        )
    if not ops:
        return
    try:
        db = get_db()
        await db.broadcast_tracked_tours.bulk_write(ops, ordered=False)
    except Exception as exc:
        logger.debug("[broadcasts] could not bulk-track tours: %s", exc)


_last_top_track = 0.0


# Throttles tracking of top broadcasts to once every five minutes
async def track_top_events(data: dict):
    global _last_top_track
    now = time.monotonic()
    if now - _last_top_track < 300:
        return
    _last_top_track = now
    events = (
        (data.get("active") or [])[:12]
        + (data.get("upcoming") or [])[:8]
        + (data.get("past") or [])[:12]
    )
    await track_events(events)


# Enqueues broadcast game for Stockfish analysis
async def enqueue_game(
    round_id: str,
    game_id: str,
    tour_id: Optional[str] = None,
    *,
    priority: int = 1,
    is_live: bool = False,
    requested_by: Optional[str] = None,
    pgn_text: Optional[str] = None,
    force: bool = False,
) -> dict:
    db = get_db()
    now = datetime.now(timezone.utc)
    existing = await db.broadcast_analyses.find_one(
        {"round_id": round_id, "game_id": game_id},
        {"finished": 1, "ply_count": 1},
    )
    should_skip = existing and existing.get("finished") and not is_live and pgn_text is None and not requested_by and not force
    if should_skip:
        return {"status": "done", "round_id": round_id, "game_id": game_id}

    queued = await db.broadcast_analysis_queue.find_one(
        {"round_id": round_id, "game_id": game_id},
        {"status": 1, "priority": 1},
    )
    if queued and queued.get("status") in ("queued", "running") and not force:
        if int(priority) < int(queued.get("priority", 10)):
            await db.broadcast_analysis_queue.update_one(
                {"round_id": round_id, "game_id": game_id},
                {"$set": {"priority": int(priority), "is_live": bool(is_live), "updated_at": now}},
            )
        return {
            "status": queued.get("status"),
            "round_id": round_id,
            "game_id": game_id,
        }
    if queued and (queued.get("status") in ("done", "failed", "skipped") or force):
        await db.broadcast_analysis_queue.update_one(
            {"round_id": round_id, "game_id": game_id},
            {"$set": {"status": "queued", "priority": int(priority), "is_live": bool(is_live), "attempts": 0, "error": None, "requested_by": requested_by, "updated_at": now}},
        )
        return {"status": "queued", "round_id": round_id, "game_id": game_id}

    set_fields = {
        "status": "queued",
        "priority": int(priority),
        "is_live": bool(is_live),
        "requested_by": requested_by,
        "auto": requested_by is None and pgn_text is None,
        "updated_at": now,
    }
    insert_fields = {
        "round_id": round_id,
        "game_id": game_id,
        "created_at": now,
        "attempts": 0,
    }
    if requested_by:
        set_fields["attempts"] = 0
    if tour_id:
        set_fields["tour_id"] = tour_id
    if pgn_text:
        set_fields["pgn_text"] = pgn_text

    update = {
        "$set": set_fields,
        "$setOnInsert": insert_fields,
    }
    await db.broadcast_analysis_queue.update_one(
        {"round_id": round_id, "game_id": game_id},
        update,
        upsert=True,
    )
    return {"status": "queued", "round_id": round_id, "game_id": game_id}


# Enqueues finished games in round for analysis
async def enqueue_round_games(round_detail: dict, priority: int = 1, max_games: Optional[int] = None):
    event = round_detail.get("event") or {}
    tour_id = event.get("id")
    round_id = round_detail.get("id")
    if not round_id:
        return 0
    count = 0
    for game in round_detail.get("games") or []:
        if max_games is not None and count >= max_games:
            break
        if game.get("result") == "*":
            continue
        result = await enqueue_game(
            round_id,
            game.get("id"),
            tour_id,
            priority=priority,
        )
        if result.get("status") == "queued":
            count += 1
    return count


# Boosts priority of selected broadcast game
async def prioritize_game_analysis(
    tour_id: Optional[str],
    round_id: str,
    game_id: str,
    is_live: bool = False,
) -> dict:
    round_id = _validate_id(round_id, "round id")
    game_id = _validate_id(game_id, "game id")
    prio = 1 if is_live else 2
    return await enqueue_game(
        round_id,
        game_id,
        tour_id,
        priority=prio,
        is_live=is_live,
    )


# Enqueues live broadcast games when newer plies are detected
async def _check_and_enqueue_live_updates(tour_id: str, round_id: str, games: list[dict]):
    if not games or not round_id:
        return
    try:
        db = get_db()
        for g in games:
            if g.get("moves"):
                gid = g.get("id")
                if not gid:
                    continue
                curr_plies = len(g["moves"])
                cached = await db.broadcast_analyses.find_one(
                    {"round_id": round_id, "game_id": gid},
                    {"ply_count": 1},
                )
                cached_plies = int(cached.get("ply_count", 0)) if cached else 0
                if curr_plies > cached_plies:
                    await enqueue_game(
                        round_id=round_id,
                        game_id=gid,
                        tour_id=tour_id,
                        priority=1,
                        is_live=True,
                        force=True,
                    )
    except Exception as exc:
        logger.debug("[broadcasts] could not enqueue live updates: %s", exc)


_event_analysis_locks: dict[str, asyncio.Lock] = {}
_event_analysis_locks_guard = asyncio.Lock()


# Acquires lock for synchronizing tournament analysis enrollment
async def _event_lock_for(tour_id: str) -> asyncio.Lock:
    async with _event_analysis_locks_guard:
        lock = _event_analysis_locks.get(tour_id)
        if lock is None:
            lock = asyncio.Lock()
            _event_analysis_locks[tour_id] = lock
        return lock


# Enqueues all matches of all rounds for a broadcast tournament
async def enqueue_full_event_analysis(tour_id: str) -> dict:
    tour_id = _validate_id(tour_id, "tournament id")
    db = get_db()
    existing = await db.broadcast_event_analysis_state.find_one({"tour_id": tour_id})
    if existing and existing.get("status") in ("queued", "in_progress", "completed"):
        return {"status": existing.get("status"), "tour_id": tour_id, "deduped": True}

    lock = await _event_lock_for(tour_id)
    async with lock:
        existing = await db.broadcast_event_analysis_state.find_one({"tour_id": tour_id})
        if existing and existing.get("status") in ("queued", "in_progress", "completed"):
            return {"status": existing.get("status"), "tour_id": tour_id, "deduped": True}

        now = datetime.now(timezone.utc)
        await db.broadcast_event_analysis_state.update_one(
            {"tour_id": tour_id},
            {
                "$set": {
                    "tour_id": tour_id,
                    "status": "queued",
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "created_at": now,
                    "total_rounds": 0,
                    "total_games": 0,
                    "completed_games": 0,
                },
            },
            upsert=True,
        )
        asyncio.create_task(
            _populate_event_analysis_queue(tour_id),
            name=f"populate-event-{tour_id}",
        )
        return {"status": "queued", "tour_id": tour_id, "deduped": False}


# Populates analysis queue with all games from all rounds of tournament
async def _populate_event_analysis_queue(tour_id: str):
    db = get_db()
    now = datetime.now(timezone.utc)
    try:
        await db.broadcast_event_analysis_state.update_one(
            {"tour_id": tour_id},
            {"$set": {"status": "in_progress", "updated_at": now}},
        )
        event = await get_tournament(tour_id)
        rounds = event.get("rounds") or []
        total_games = 0
        for round_meta in rounds:
            round_id = round_meta.get("id")
            if not round_id:
                continue
            try:
                detail = await get_round(tour_id, round_id)
                games = detail.get("games") or []
                for game in games:
                    game_id = game.get("id")
                    if not game_id:
                        continue
                    total_games += 1
                    is_live = game.get("result") == "*"
                    prio = 1 if is_live else 10
                    await enqueue_game(
                        round_id,
                        game_id,
                        tour_id,
                        priority=prio,
                        is_live=is_live,
                    )
            except Exception as exc:
                logger.warning("[broadcasts] could not queue games for round %s: %s", round_id, exc)

        await db.broadcast_event_analysis_state.update_one(
            {"tour_id": tour_id},
            {
                "$set": {
                    "total_rounds": len(rounds),
                    "total_games": total_games,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        logger.info("[broadcasts] queued %d games across %d rounds for tour %s", total_games, len(rounds), tour_id)
    except Exception as exc:
        logger.error("[broadcasts] failed populating queue for tour %s: %s", tour_id, exc)


# Reports tournament analysis progress and completion status
async def event_analysis_progress(tour_id: str) -> dict:
    tour_id = _validate_id(tour_id, "tournament id")
    db = get_db()
    state = await db.broadcast_event_analysis_state.find_one({"tour_id": tour_id})
    if not state:
        return {"status": "none", "tour_id": tour_id}
    completed_count = await db.broadcast_analyses.count_documents({"tour_id": tour_id})
    queued_count = await db.broadcast_analysis_queue.count_documents(
        {"tour_id": tour_id, "status": "queued"}
    )
    running_count = await db.broadcast_analysis_queue.count_documents(
        {"tour_id": tour_id, "status": "running"}
    )
    total = state.get("total_games") or (completed_count + queued_count + running_count)
    is_done = total > 0 and completed_count >= total
    status_str = "completed" if is_done else state.get("status", "in_progress")
    if is_done and state.get("status") != "completed":
        try:
            await db.broadcast_event_analysis_state.update_one(
                {"tour_id": tour_id},
                {"$set": {"status": "completed", "updated_at": datetime.now(timezone.utc)}},
            )
        except Exception:
            pass
    return {
        "status": status_str,
        "tour_id": tour_id,
        "total_games": total,
        "completed_games": completed_count,
        "queued_games": queued_count,
        "running_games": running_count,
        "total_rounds": state.get("total_rounds", 0),
    }


# Returns cached analysis or queue status for game
async def analysis_status(round_id: str, game_id: str) -> dict:
    db = get_db()
    queue = await db.broadcast_analysis_queue.find_one({"round_id": round_id, "game_id": game_id})
    analysis = await db.broadcast_analyses.find_one({"round_id": round_id, "game_id": game_id})
    if queue and queue.get("status") in ("queued", "running"):
        return {
            "status": queue.get("status"),
            "analysis": public_analysis(analysis) if analysis else None,
            "queue": {
                "attempts": queue.get("attempts", 0),
                "error": queue.get("error"),
                "priority": queue.get("priority", 1),
            },
        }
    if analysis:
        return {"status": "done", "analysis": public_analysis(analysis)}
    if queue:
        return {
            "status": queue.get("status") or "queued",
            "queue": {
                "attempts": queue.get("attempts", 0),
                "error": queue.get("error"),
                "priority": queue.get("priority", 1),
            },
        }
    return {"status": "missing"}


# Sanitizes analysis document for public consumption
def public_analysis(doc: dict) -> dict:
    out = {k: v for k, v in doc.items() if k != "_id"}
    out.pop("requested_by", None)
    return out


# Returns mapping of game ID to analysis summary for round
async def get_round_analysis_map(round_id: str, game_ids: list[str]) -> dict:
    if not game_ids:
        return {}
    db = get_db()
    out = {}
    try:
        cursor = db.broadcast_analyses.find(
            {"round_id": round_id, "game_id": {"$in": game_ids}},
            {
                "game_id": 1, "accuracy_white": 1, "accuracy_black": 1,
                "ply_count": 1, "finished": 1, "updated_at": 1, "analyzed_by": 1,
                "auto": 1,
            },
        )
        async for doc in cursor:
            out[doc["game_id"]] = {
                "status": "done",
                "accuracy_white": doc.get("accuracy_white"),
                "accuracy_black": doc.get("accuracy_black"),
                "ply_count": doc.get("ply_count"),
                "finished": doc.get("finished"),
                "updated_at": doc.get("updated_at"),
                "analyzed_by": doc.get("analyzed_by"),
                "auto": doc.get("auto"),
            }
    except Exception as exc:
        logger.debug("[broadcasts] analysis map failed: %s", exc)
    try:
        cursor = db.broadcast_analysis_queue.find(
            {"round_id": round_id, "game_id": {"$in": game_ids}},
            {"game_id": 1, "status": 1, "priority": 1},
        )
        async for doc in cursor:
            gid = doc["game_id"]
            if gid not in out:
                out[gid] = {"status": doc.get("status") or "queued"}
    except Exception:
        pass
    return out


# Section broadcasts/analysis

# Resolves path to local Stockfish binary
def _engine_path() -> str:
    path = Path(settings.sf_path or "")
    if not path.is_absolute():
        path = (BACKEND_DIR / path).resolve()
    return str(path)


# Locates game matching identifier within PGN string
def _find_pgn_game(pgn_text: str, game_id: str) -> Optional[chess.pgn.Game]:
    stream = io.StringIO(pgn_text or "")
    games = []
    while True:
        try:
            game = chess.pgn.read_game(stream)
        except Exception:
            break
        if game is None:
            break
        games.append(game)
    if not games:
        return None
    if game_id in ("import", "pgn", ""):
        return games[0]
    for game in games:
        if _pgn_game_id(game) == game_id:
            return game
        url = game.headers.get("GameURL") or game.headers.get("Site") or ""
        if game_id and game_id in url:
            return game
    if game_id and game_id.isdigit():
        idx = int(game_id)
        if 0 <= idx < len(games):
            return games[idx]
    for game in games:
        w_name = str(game.headers.get("White") or "")
        b_name = str(game.headers.get("Black") or "")
        if game_id and (game_id in w_name or game_id in b_name):
            return game
    return games[0] if len(games) == 1 else None


# Normalizes engine evaluation score to centipawns
def _score_cp(info) -> int:
    try:
        score = info.get("score")
        if not score:
            return 0
        cp = score.white().score(mate_score=10000)
        return int(cp or 0)
    except Exception:
        return 0


# Extracts best move UCI string from engine info
def _best_uci(info) -> Optional[str]:
    try:
        pv = info.get("pv") or []
        return pv[0].uci() if pv else None
    except Exception:
        return None


# Manages Stockfish process for broadcast game analysis
class _BroadcastAnalyzer:

    def __init__(self):
        self._engine: Optional[chess.engine.SimpleEngine] = None
        self._lock = asyncio.Lock()
        self._eval_cache: dict[tuple[str, int], dict] = {}

    # Spawns and configures Stockfish engine process
    async def _ensure_engine(self):
        if self._engine is not None:
            return
        path = _engine_path()
        engine = await asyncio.to_thread(chess.engine.SimpleEngine.popen_uci, path)
        try:
            await asyncio.to_thread(
                engine.configure,
                {"Hash": max(16, int(settings.broadcast_engine_hash_mb)), "Threads": 1},
            )
        except Exception as exc:
            logger.warning("[broadcasts] Stockfish configure failed: %s", exc)
        self._engine = engine
        logger.info("[broadcasts] Dedicated Stockfish process started at %s", path)

    # Terminates engine process safely
    async def quit(self):
        if self._engine is not None:
            try:
                await asyncio.to_thread(self._engine.quit)
            except Exception:
                pass
            self._engine = None

    # Evaluates single board position at specified depth
    async def evaluate(self, fen: str, depth: int) -> dict:
        key = (fen, depth)
        cached = self._eval_cache.get(key)
        if cached is not None:
            return cached
        board = chess.Board(fen)
        if board.is_game_over():
            if board.is_checkmate():
                cp = -10000 if board.turn == chess.WHITE else 10000
            else:
                cp = 0
            return {"cp": cp, "best_uci": None}
        await self._ensure_engine()
        async with self._lock:
            cached = self._eval_cache.get(key)
            if cached is not None:
                return cached
            info = await asyncio.to_thread(
                self._engine.analyse,
                board,
                chess.engine.Limit(depth=depth, time=0.25),
            )
            result = {"cp": _score_cp(info), "best_uci": _best_uci(info)}
            self._eval_cache[key] = result
            if len(self._eval_cache) > 12000:
                self._eval_cache.clear()
            return result

    # Analyses full PGN game producing accuracy and key moments
    async def analyze_pgn(self, pgn_text: str, game_id: str, depth: int) -> Optional[dict]:
        game = _find_pgn_game(pgn_text, game_id)
        if game is None:
            return None

        board = game.board()
        fens = [board.fen()]
        move_meta = []
        for node in game.mainline():
            move = node.move
            if not move:
                continue
            try:
                san = board.san(move)
            except Exception:
                san = node.san() if hasattr(node, "san") else str(move)
            uci = move.uci()
            is_white = board.turn == chess.WHITE
            comment = (node.comment or "").strip()
            clk_match = re.search(r"\[%clk\s+([0-9:]+)\]", comment)
            clock_str = clk_match.group(1) if clk_match else None

            eval_match = re.search(r"\[%eval\s+([+-]?[0-9.]+|#[+-]?[0-9]+)\]", comment)
            eval_cp = None
            if eval_match:
                raw_v = eval_match.group(1)
                try:
                    if raw_v.startswith("#"):
                        m_val = int(raw_v.replace("#", ""))
                        eval_cp = 10000 if m_val > 0 else -10000
                    else:
                        eval_cp = int(round(float(raw_v) * 100))
                except Exception:
                    eval_cp = None

            classification = None
            if san.endswith("??") or re.search(r"\bblunder\b", comment, re.I):
                classification = "blunder"
            elif san.endswith("?!") or re.search(r"\binaccuracy\b", comment, re.I):
                classification = "inaccuracy"
            elif san.endswith("?") or re.search(r"\bmistake\b", comment, re.I):
                classification = "mistake"
            elif san.endswith("!") or re.search(r"\bbest\b", comment, re.I):
                classification = "best"

            best_match = re.search(r"(?:Inaccuracy|Mistake|Blunder)\.\s+([A-Za-z0-9+#=]+)\s+was\s+best", comment, re.I)
            best_san = best_match.group(1) if best_match else None
            clean_comment = re.sub(r"\[%(?:clk|eval|emt)[^\]]*\]", "", comment).strip()
            clean_comment = re.sub(r"\s+", " ", clean_comment).strip()

            try:
                board.push(move)
            except Exception:
                try:
                    board.push_uci(uci)
                except Exception:
                    try:
                        board.push_san(san)
                    except Exception:
                        pass
            fens.append(board.fen())
            move_meta.append({
                "san": san,
                "uci": uci,
                "is_white": is_white,
                "comment": clean_comment or None,
                "clock_str": clock_str,
                "eval_cp": eval_cp,
                "classification": classification,
                "best_move_san": best_san,
            })

        if not move_meta:
            return None

        evals = []
        for idx, fen in enumerate(fens):
            if idx > 0 and move_meta[idx - 1].get("eval_cp") is not None:
                evals.append({"cp": move_meta[idx - 1]["eval_cp"], "best_uci": None})
            else:
                try:
                    evals.append(await self.evaluate(fen, depth))
                except Exception as exc:
                    logger.warning("[broadcasts] evaluation failed for %s: %s", fen[:40], exc)
                    evals.append({"cp": 0, "best_uci": None})

        analyzed_moves = []
        white_acc = []
        black_acc = []
        key_moments = []
        eval_graph = [{
            "ply": 0,
            "eval_cp": evals[0]["cp"],
            "win_white": round(eval_to_win_prob(evals[0]["cp"]) * 100.0, 1),
        }]

        for idx, meta in enumerate(move_meta):
            before = evals[idx]
            after = evals[idx + 1]
            is_white = meta["is_white"]
            cp_loss = max(
                0.0,
                float(before["cp"] - after["cp"]) if is_white
                else float(after["cp"] - before["cp"]),
            )
            win_before = eval_to_win_prob(before["cp"] if is_white else -before["cp"]) * 100.0
            win_after = eval_to_win_prob(after["cp"] if is_white else -after["cp"]) * 100.0
            accuracy = accuracy_from_wp_diff(win_before, win_after)
            best_uci = before.get("best_uci")
            is_best = bool(best_uci and meta["uci"] == best_uci)
            classification = meta.get("classification") or classify_loss(cp_loss, is_best=is_best)
            if classification == "best":
                is_best = True

            best_san = meta.get("best_move_san") or ""
            if not best_san and best_uci:
                try:
                    probe = chess.Board(fens[idx])
                    best_move = chess.Move.from_uci(best_uci)
                    if best_move in probe.legal_moves:
                        best_san = probe.san(best_move)
                except Exception:
                    best_san = ""

            if is_white:
                white_acc.append(accuracy)
            else:
                black_acc.append(accuracy)

            ply = idx + 1
            turn = "white" if is_white else "black"
            record = {
                "ply": ply,
                "move_number": (ply + 1) // 2,
                "turn": turn,
                "san": meta["san"],
                "uci": meta["uci"],
                "comment": meta.get("comment"),
                "clock_str": meta.get("clock_str"),
                "best_move": best_uci,
                "best_move_san": best_san,
                "is_best": is_best,
                "eval_before_cp": int(before["cp"]),
                "eval_after_cp": int(after["cp"]),
                "cp_loss": round(cp_loss, 1),
                "accuracy_score": accuracy,
                "classification": classification,
                "win_probability_before": round(win_before, 1),
                "win_probability_after": round(win_after, 1),
                "fen_before": fens[idx],
                "fen_after": fens[idx + 1],
            }
            analyzed_moves.append(record)

            delta = abs(win_before - win_after)
            if delta >= 12.0 or classification in ("mistake", "blunder"):
                key_moments.append({
                    "ply": ply,
                    "san": meta["san"],
                    "classification": classification,
                    "delta_win_prob": round(delta / 100.0, 4),
                    "eval_before_cp": int(before["cp"]),
                    "eval_after_cp": int(after["cp"]),
                })

            eval_graph.append({
                "ply": ply,
                "eval_cp": int(after["cp"]),
                "win_white": round(eval_to_win_prob(after["cp"]) * 100.0, 1),
            })

        key_moments.sort(key=lambda item: item["delta_win_prob"], reverse=True)
        headers = {k: str(v) for k, v in (game.headers or {}).items()}
        result = headers.get("Result", "*")
        finished = result in ("1-0", "0-1", "½-½", "1/2-1/2")
        w_name = headers.get("White") or "White"
        b_name = headers.get("Black") or "Black"
        w_fide = str(headers.get("WhiteFideId") or "").strip() or None
        b_fide = str(headers.get("BlackFideId") or "").strip() or None

        return {
            "headers": {
                "white": w_name,
                "black": b_name,
                "white_title": headers.get("WhiteTitle"),
                "black_title": headers.get("BlackTitle"),
                "white_fide_id": w_fide,
                "black_fide_id": b_fide,
                "white_avatar": _player_avatar_url(w_name, w_fide),
                "black_avatar": _player_avatar_url(b_name, b_fide),
                "white_elo": headers.get("WhiteElo"),
                "black_elo": headers.get("BlackElo"),
                "event": headers.get("Event") or headers.get("BroadcastName") or "",
                "date": headers.get("Date") or headers.get("UTCDate") or "",
                "result": result,
                "eco": headers.get("ECO"),
                "opening": headers.get("Opening"),
            },
            "result": result,
            "finished": finished,
            "ply_count": len(analyzed_moves),
            "accuracy_white": round(sum(white_acc) / len(white_acc), 1) if white_acc else 0.0,
            "accuracy_black": round(sum(black_acc) / len(black_acc), 1) if black_acc else 0.0,
            "moves": analyzed_moves,
            "key_moments": key_moments[:5],
            "eval_graph": eval_graph,
        }


_analyzer = _BroadcastAnalyzer()


# Analyzes single FEN position with Stockfish MultiPV
async def analyze_position_for_broadcast(fen: str, multipv: int = 3) -> dict:
    from engines import analyze_position
    depth = max(6, min(int(settings.broadcast_position_depth), 30))
    result = await analyze_position(fen, multipv=multipv, depth=depth)
    candidates = [c.model_dump() for c in result.stockfish_candidates]
    best = candidates[0] if candidates else None
    return {
        "fen": fen,
        "best_move": best,
        "candidates": candidates,
        "win_white": round((best.get("win_prob", 0.5) if best else 0.5) * 100.0, 1),
    }


# Section broadcasts/worker

# Processes broadcast analysis queue in background worker
class BroadcastAnalysisWorker:
    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self._backfill_task: Optional[asyncio.Task] = None

    # Starts worker loop and periodic backfill tasks
    async def start(self):
        if self._task and not self._task.done():
            return
        try:
            db = get_db()
            await db.broadcast_analysis_queue.update_many(
                {"status": "running"},
                {"$set": {"status": "queued"}},
            )
        except Exception as exc:
            logger.warning("[broadcasts] could not recover queue: %s", exc)
        self._stop.clear()
        self._task = asyncio.create_task(self._loop(), name="broadcast-analysis-worker")
        self._backfill_task = asyncio.create_task(self._backfill_loop(), name="broadcast-backfill")
        logger.info("[broadcasts] analysis worker started")

    # Stops background worker tasks and shuts down analyzer
    async def stop(self):
        self._stop.set()
        for task in (self._task, self._backfill_task):
            if task is not None:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    pass
        self._task = None
        self._backfill_task = None
        await _analyzer.quit()
        logger.info("[broadcasts] analysis worker stopped")

    # Checks whether automatic daily analysis limit has been reached
    async def _daily_limit_reached(self) -> bool:
        limit = int(settings.broadcast_auto_analysis_daily_limit or 0)
        if limit <= 0:
            return False
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        try:
            db = get_db()
            count = await db.broadcast_analyses.count_documents({
                "auto": True,
                "created_at": {"$gte": start},
            })
            return count >= limit
        except Exception:
            return False

    # Runs continuous queue processing loop
    async def _loop(self):
        while not self._stop.is_set():
            try:
                limit_reached = await self._daily_limit_reached()
                db = get_db()
                query = {"status": "queued"}
                if limit_reached:
                    query["auto"] = False
                job = await db.broadcast_analysis_queue.find_one_and_update(
                    query,
                    {"$set": {"status": "running", "started_at": datetime.now(timezone.utc)}},
                    sort=[("priority", 1), ("is_live", -1), ("created_at", 1)],
                    return_document=True,
                )
                if not job:
                    await asyncio.sleep(300 if limit_reached else 5)
                    continue
                await self._run_job(job)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("[broadcasts] worker loop error: %s", exc)
                await asyncio.sleep(5)

    # Executes analysis for single queued job
    async def _run_job(self, job: dict):
        db = get_db()
        round_id = job.get("round_id")
        game_id = job.get("game_id")
        try:
            pgn_text = job.get("pgn_text")
            if not pgn_text:
                pgn_text = await get_round_pgn(round_id)
            depth = max(6, min(int(settings.broadcast_analysis_depth), 24))
            analysis = await _analyzer.analyze_pgn(
                pgn_text,
                game_id,
                depth=depth,
            )
            if analysis is None:
                await db.broadcast_analysis_queue.update_one(
                    {"_id": job["_id"]},
                    {"$set": {
                        "status": "skipped",
                        "finished_at": datetime.now(timezone.utc),
                        "error": "No moves found for this game yet.",
                    }},
                )
                return

            now = datetime.now(timezone.utc)
            doc = {
                "round_id": round_id,
                "game_id": game_id,
                "tour_id": job.get("tour_id"),
                **analysis,
                "engine": "stockfish",
                "engine_depth": depth,
                "analyzed_by": job.get("requested_by") or "auto",
                "auto": bool(job.get("auto")),
                "updated_at": now,
            }
            await db.broadcast_analyses.update_one(
                {"round_id": round_id, "game_id": game_id},
                {"$set": doc, "$setOnInsert": {"created_at": now}},
                upsert=True,
            )
            await db.broadcast_analysis_queue.update_one(
                {"_id": job["_id"]},
                {"$set": {
                    "status": "done",
                    "finished_at": now,
                    "error": None,
                }},
            )
            if job.get("tour_id"):
                try:
                    await db.broadcast_event_analysis_state.update_one(
                        {"tour_id": job["tour_id"]},
                        {"$inc": {"completed_games": 1}, "$set": {"updated_at": now}},
                    )
                except Exception:
                    pass
            logger.info("[broadcasts] analysed %s/%s (%d plies)", round_id, game_id, analysis["ply_count"])
        except Exception as exc:
            attempts = int(job.get("attempts") or 0) + 1
            status = "failed" if attempts >= 3 else "queued"
            logger.warning("[broadcasts] analysis job failed (%s/%s): %s", round_id, game_id, exc)
            try:
                await db.broadcast_analysis_queue.update_one(
                    {"_id": job["_id"]},
                    {"$set": {
                        "status": status,
                        "attempts": attempts,
                        "error": str(exc)[:400],
                        "updated_at": datetime.now(timezone.utc),
                    }},
                )
            except Exception:
                pass
        finally:
            await asyncio.sleep(1)

    # Runs periodic background scan of recent broadcasts
    async def _backfill_loop(self):
        while not self._stop.is_set():
            try:
                await asyncio.sleep(600)
                await self._backfill_once()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.debug("[broadcasts] backfill error: %s", exc)

    # Scans recently tracked tournaments and enqueues finished games
    async def _backfill_once(self):
        db = get_db()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        tours = await db.broadcast_tracked_tours.find(
            {"last_seen": {"$gte": cutoff}}
        ).sort([("last_scanned_at", 1), ("last_seen", -1)]).limit(5).to_list(5)
        scanned = 0
        try:
            pending = await db.broadcast_analysis_queue.count_documents(
                {"status": {"$in": ["queued", "running"]}}
            )
        except Exception:
            pending = 0
        budget = max(0, 600 - pending)
        if budget <= 0:
            return
        for tracked in tours:
            if scanned >= 12 or budget <= 0:
                break
            tour_id = tracked.get("tour_id")
            if not tour_id:
                continue
            try:
                event = await get_tournament(tour_id)
            except Exception:
                continue
            now = datetime.now(timezone.utc)
            try:
                await db.broadcast_tracked_tours.update_one(
                    {"tour_id": tour_id},
                    {"$set": {"last_scanned_at": now}},
                )
            except Exception:
                pass
            for round_meta in event.get("rounds") or []:
                if scanned >= 12:
                    break
                starts = round_meta.get("starts_at")
                if not starts:
                    continue
                try:
                    starts_dt = datetime.fromisoformat(starts)
                except Exception:
                    continue
                if starts_dt > now:
                    continue
                round_id = round_meta.get("id")
                if not round_id:
                    continue
                try:
                    last_scan = await db.broadcast_round_scans.find_one({"round_id": round_id})
                    if last_scan and last_scan.get("scanned_at"):
                        scanned_at = last_scan["scanned_at"]
                        if scanned_at.tzinfo is None:
                            scanned_at = scanned_at.replace(tzinfo=timezone.utc)
                        if (now - scanned_at).total_seconds() < 6 * 3600:
                            continue
                    detail = await get_round(tour_id, round_id)
                    queued = await enqueue_round_games(detail, priority=3, max_games=budget)
                    budget -= queued
                    await db.broadcast_round_scans.update_one(
                        {"round_id": round_id},
                        {"$set": {
                            "round_id": round_id,
                            "tour_id": tour_id,
                            "scanned_at": now,
                            "finished": detail.get("finished", False),
                        }},
                        upsert=True,
                    )
                    scanned += 1
                    if budget <= 0:
                        break
                except Exception:
                    continue


_worker = BroadcastAnalysisWorker()


# Starts background broadcast analysis worker
async def init_broadcast_worker():
    await _worker.start()


# Shuts down background broadcast analysis worker
async def shutdown_broadcast_worker():
    await _worker.stop()
