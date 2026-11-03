"""Retry rule shared by the API connectors (Ramp, Gmail).

Rate limits and server errors are retried; everything else is returned for the
caller to judge. Only reads and token requests go through here, so a repeat is safe.
"""

import time
from collections.abc import Callable

import httpx

MAX_ATTEMPTS = 4
MAX_RETRY_WAIT_SECONDS = 90.0


def send_with_retry(
    send: Callable[[], httpx.Response],
    *,
    service: str,
    fail: Callable[[str], Exception],
    sleep: Callable[[float], None] = time.sleep,
    rate_limit_wait: float | None = None,
) -> httpx.Response:
    """`fail` builds the exception to raise; its message must be safe to show a person."""
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = send()
        except httpx.TransportError as exc:
            if attempt == MAX_ATTEMPTS - 1:
                raise fail(f"Could not reach {service}. Try again shortly.") from exc
            sleep(2.0**attempt)
            continue
        if response.status_code != 429 and response.status_code < 500:
            return response
        if attempt < MAX_ATTEMPTS - 1:
            sleep(retry_wait(response, attempt, rate_limit_wait))
    raise fail(f"{service} kept returning {response.status_code}. Try again shortly.")


def retry_wait(response: httpx.Response, attempt: int, rate_limit_wait: float | None) -> float:
    header = response.headers.get("Retry-After", "")
    if header.isdigit():
        return min(float(header), MAX_RETRY_WAIT_SECONDS)
    if response.status_code == 429 and rate_limit_wait is not None:
        return rate_limit_wait
    return 2.0**attempt
