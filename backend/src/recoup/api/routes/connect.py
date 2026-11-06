"""Connect Gmail from the web app, read-only.

The same consent flow as `recoup connect gmail`, with the API as the redirect target.
State and PKCE live in memory for a few minutes; the refresh token is written to the
server's env file and never sent to the browser.
"""

import secrets
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import SecretStr

from recoup.api.deps import ContextDep
from recoup.ingest.gmail import GmailError
from recoup.ingest.google_oauth import (
    REFRESH_TOKEN_VAR,
    Pkce,
    authorization_url,
    exchange_code,
    new_pkce,
    write_env_var,
)

router = APIRouter(prefix="/api/connect")
CONSENT_TTL_SECONDS = 600
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


@dataclass(frozen=True, slots=True)
class _Pending:
    pkce: Pkce
    redirect_uri: str
    return_to: str
    expires_at: float


_pending: dict[str, _Pending] = {}
_lock = threading.Lock()


def _return_to(request: Request) -> str:
    """Back to the page that started the flow, but only if it is this machine's app."""
    referer = urlsplit(request.headers.get("referer", ""))
    if referer.scheme in ("http", "https") and referer.hostname in _LOCAL_HOSTS:
        return f"{referer.scheme}://{referer.netloc}/"
    return "/"


def _back(return_to: str, **result: str) -> RedirectResponse:
    return RedirectResponse(f"{return_to}#/setup?{urlencode(result)}", status_code=303)


@router.get("/gmail")
def start_gmail(request: Request, context: ContextDep) -> RedirectResponse:
    settings = context.settings
    if not (settings.gmail_client_id and settings.gmail_client_secret):
        raise HTTPException(
            status_code=409,
            detail="Set RECOUP_GMAIL_CLIENT_ID and RECOUP_GMAIL_CLIENT_SECRET on the server first.",
        )
    state, pkce = secrets.token_urlsafe(24), new_pkce()
    redirect_uri = str(request.url_for("finish_gmail"))
    now = time.monotonic()
    with _lock:
        for key in [k for k, p in _pending.items() if p.expires_at < now]:
            del _pending[key]
        _pending[state] = _Pending(
            pkce, redirect_uri, _return_to(request), now + CONSENT_TTL_SECONDS
        )
    url = authorization_url(settings.gmail_client_id, redirect_uri, state, pkce)
    return RedirectResponse(url, status_code=303)


@router.get("/gmail/callback", name="finish_gmail")
def finish_gmail(
    context: ContextDep, state: str = "", code: str = "", error: str = ""
) -> RedirectResponse:
    with _lock:
        pending = _pending.pop(state, None)
    if pending is None or pending.expires_at < time.monotonic():
        return _back("/", gmail="error", reason="That sign-in expired. Connect again.")
    if not code:
        return _back(pending.return_to, gmail="error", reason=f"Google said: {error[:64] or 'no'}")
    settings = context.settings
    if not (settings.gmail_client_id and settings.gmail_client_secret):
        return _back(pending.return_to, gmail="error", reason="Gmail is not set up on the server.")
    try:
        token = exchange_code(
            settings.gmail_client_id,
            settings.gmail_client_secret.get_secret_value(),
            code,
            pending.redirect_uri,
            pending.pkce,
        )
    except GmailError as exc:
        return _back(pending.return_to, gmail="error", reason=str(exc))
    write_env_var(settings.env_path, REFRESH_TOKEN_VAR, token)
    # The running app shares this settings object with the Gmail connector, so the
    # next sync uses the new token without a restart.
    settings.gmail_refresh_token = SecretStr(token)
    return _back(pending.return_to, gmail="connected")
