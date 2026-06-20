"""Simple in-memory rate limiter middleware for ViMax Web API."""

import time
from collections import defaultdict
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class RateLimiterMiddleware(BaseHTTPMiddleware):
    """Per-IP sliding-window rate limiter.

    Defaults: 120 requests per 60 seconds per IP.
    """

    def __init__(self, app, max_requests: int = 120, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._buckets: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        # Skip health check
        if request.url.path == "/api/health":
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()

        # Prune expired timestamps
        cutoff = now - self.window_seconds
        self._buckets[client_ip] = [
            ts for ts in self._buckets[client_ip] if ts > cutoff
        ]

        if len(self._buckets[client_ip]) >= self.max_requests:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down and try again later."},
            )

        self._buckets[client_ip].append(now)

        # Periodic cleanup — keep at most 50 IP entries
        if len(self._buckets) > 50:
            stale = [ip for ip, ts_list in self._buckets.items()
                     if not ts_list or all(ts <= cutoff for ts in ts_list)]
            for ip in stale:
                del self._buckets[ip]

        return await call_next(request)
