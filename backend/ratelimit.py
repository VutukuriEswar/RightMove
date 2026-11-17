# Provides simple in-process token-bucket rate limiting middleware
import time
import asyncio
from collections import defaultdict
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


_AUTH_PATHS = {"/auth/signup", "/auth/login"}
_AUTH_LIMIT = 10
_AUTH_WINDOW = 60

_API_LIMIT = 120
_API_WINDOW = 60

_BUCKETS: dict[str, list[float]] = defaultdict(list)
_LOCK = asyncio.Lock()


# Returns client IP from request headers or connection
def _get_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


# Checks whether IP has exceeded the given limit in window seconds
def _is_limited(key: str, limit: int, window: int) -> bool:
    now = time.monotonic()
    bucket = _BUCKETS[key]
    cutoff = now - window
    _BUCKETS[key] = [t for t in bucket if t > cutoff]
    if len(_BUCKETS[key]) >= limit:
        return True
    _BUCKETS[key].append(now)
    return False


# Applies per-IP token-bucket rate limiting on HTTP requests
class _RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        ip = _get_ip(request)
        async with _LOCK:
            if path in _AUTH_PATHS:
                if _is_limited(f"auth:{ip}", _AUTH_LIMIT, _AUTH_WINDOW):
                    return JSONResponse(
                        {"detail": f"Rate limit exceeded: max {_AUTH_LIMIT} requests per {_AUTH_WINDOW}s"},
                        status_code=429,
                    )
            else:
                if _is_limited(f"api:{ip}", _API_LIMIT, _API_WINDOW):
                    return JSONResponse(
                        {"detail": f"Rate limit exceeded: max {_API_LIMIT} requests per {_API_WINDOW}s"},
                        status_code=429,
                    )
        return await call_next(request)
