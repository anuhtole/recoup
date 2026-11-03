"""One-time Gmail consent for `recoup connect gmail`.

Google's loopback flow for desktop apps: open the consent page in a browser, catch
the redirect on 127.0.0.1, and exchange the code for a refresh token. PKCE and a
random state guard the exchange. The refresh token is written to the env file,
readable by the owner only, and is never printed.
"""

import base64
import hashlib
import os
import secrets
import time
import webbrowser
from collections.abc import Callable
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx

from recoup.ingest.gmail import SCOPE, TOKEN_URL, GmailError

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
REFRESH_TOKEN_VAR = "RECOUP_GMAIL_REFRESH_TOKEN"
CONSENT_TIMEOUT_SECONDS = 300.0
_DONE_PAGE = b"<p>Recoup can now read vendor mail. You can close this tab.</p>"
_FAIL_PAGE = b"<p>Recoup did not get access. Return to the terminal for details.</p>"


@dataclass(frozen=True, slots=True)
class Pkce:
    verifier: str
    challenge: str


def new_pkce() -> Pkce:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    return Pkce(verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode())


def authorization_url(client_id: str, redirect_uri: str, state: str, pkce: Pkce) -> str:
    query = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
        "code_challenge": pkce.challenge,
        "code_challenge_method": "S256",
        # Offline access with forced consent is what returns a refresh token.
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{AUTH_URL}?{urlencode(query)}"


def exchange_code(
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
    pkce: Pkce,
    *,
    http: httpx.Client | None = None,
) -> str:
    client = http or httpx.Client(timeout=30.0)
    try:
        response = client.post(
            TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "code_verifier": pkce.verifier,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
        )
    except httpx.TransportError as exc:
        raise GmailError("Could not reach Google to finish connecting Gmail.") from exc
    finally:
        if http is None:
            client.close()
    if response.status_code != 200:
        raise GmailError(f"Google refused the sign-in code ({response.status_code}). Try again.")
    token = response.json().get("refresh_token")
    if not isinstance(token, str) or not token:
        raise GmailError(
            "Google returned no refresh token. Remove Recoup's access in your Google "
            "account settings, then connect again."
        )
    return token


def write_env_var(path: Path, key: str, value: str) -> None:
    """Set `key` in a dotenv file, keeping every other line, readable by the owner only."""
    lines = path.read_text().splitlines() if path.exists() else []
    kept = [line for line in lines if not line.startswith(f"{key}=")]
    content = "\n".join([*kept, f"{key}={value}"]) + "\n"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(content)
    path.chmod(0o600)


def _capture_redirect(server: HTTPServer, timeout: float) -> dict[str, str]:
    """Serve requests until one arrives at /callback, then return its query."""
    received: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            url = urlsplit(self.path)
            if url.path != "/callback":
                self.send_response(404)
                self.end_headers()
                return
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            # A callback always ends the wait, even an empty one.
            received.update(query or {"error": "empty_response"})
            ok = "code" in received
            self.send_response(200 if ok else 400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(_DONE_PAGE if ok else _FAIL_PAGE)

        def log_message(self, format: str, *args: Any) -> None:
            # The query string carries the one-time code; keep it out of the terminal.
            return

    server.RequestHandlerClass = Handler
    deadline = time.monotonic() + timeout
    while not received:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise GmailError("Timed out waiting for Google sign-in. Run the command again.")
        server.timeout = remaining
        server.handle_request()
    return received


def connect_gmail(
    client_id: str,
    client_secret: str,
    env_path: Path,
    *,
    open_browser: Callable[[str], Any] = webbrowser.open,
    timeout: float = CONSENT_TIMEOUT_SECONDS,
    http: httpx.Client | None = None,
) -> None:
    """Run the consent flow and save the refresh token to `env_path`."""
    state = secrets.token_urlsafe(24)
    pkce = new_pkce()
    with HTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler) as server:
        redirect_uri = f"http://127.0.0.1:{server.server_port}/callback"
        open_browser(authorization_url(client_id, redirect_uri, state, pkce))
        params = _capture_redirect(server, timeout)
    if not secrets.compare_digest(params.get("state", ""), state):
        raise GmailError("The sign-in response did not match this request; nothing was saved.")
    if "code" not in params:
        reason = params.get("error") or "unknown"
        raise GmailError(f"Google sign-in did not complete ({reason[:64]}); nothing was saved.")
    token = exchange_code(client_id, client_secret, params["code"], redirect_uri, pkce, http=http)
    write_env_var(env_path, REFRESH_TOKEN_VAR, token)
