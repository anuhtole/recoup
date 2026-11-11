"""Connecting Gmail from the web app."""

from collections.abc import Iterator
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import Engine

from recoup.api.app import create_app
from recoup.api.routes import connect
from recoup.config import Settings
from recoup.ingest.gmail import GmailError
from recoup.services import Services

APP = "http://localhost:5181/"


@pytest.fixture
def env_path(tmp_path: Path) -> Path:
    return tmp_path / ".env"


@pytest.fixture
def client(
    engine: Engine, settings: Settings, services: Services, env_path: Path
) -> Iterator[TestClient]:
    ready = settings.model_copy(
        update={
            "gmail_client_id": "client-id",
            "gmail_client_secret": SecretStr("client-secret"),
            "env_path": env_path,
        }
    )
    with TestClient(create_app(ready, services), follow_redirects=False) as client:
        yield client


def _start(client: TestClient) -> str:
    response = client.get("/api/connect/gmail", headers={"referer": APP + "#/setup"})
    assert response.status_code == 303
    google = urlsplit(response.headers["location"])
    query = parse_qs(google.query)
    assert google.hostname == "accounts.google.com"
    assert query["scope"] == ["https://www.googleapis.com/auth/gmail.readonly"]
    assert query["redirect_uri"][0].endswith("/api/connect/gmail/callback")
    return query["state"][0]


def test_connecting_saves_the_token_on_the_server_only(
    client: TestClient, env_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(connect, "exchange_code", lambda *args, **kwargs: "refresh-token")
    state = _start(client)

    done = client.get("/api/connect/gmail/callback", params={"state": state, "code": "c"})

    assert done.headers["location"] == APP + "#/setup?gmail=connected"
    assert "refresh-token" not in done.text
    assert "RECOUP_GMAIL_REFRESH_TOKEN=refresh-token" in env_path.read_text()
    assert client.get("/api/setup").json()["connections"]["gmail"] is True


def test_a_state_is_used_once(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(connect, "exchange_code", lambda *args, **kwargs: "refresh-token")
    state = _start(client)
    client.get("/api/connect/gmail/callback", params={"state": state, "code": "c"})

    replay = client.get("/api/connect/gmail/callback", params={"state": state, "code": "c"})

    assert "gmail=error" in replay.headers["location"]


def test_denied_or_failed_consent_saves_nothing(
    client: TestClient, env_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    denied = client.get(
        "/api/connect/gmail/callback", params={"state": _start(client), "error": "access_denied"}
    )
    assert "gmail=error" in denied.headers["location"]

    def refuse(*args: object, **kwargs: object) -> str:
        raise GmailError("Google refused the sign-in code (400). Try again.")

    monkeypatch.setattr(connect, "exchange_code", refuse)
    failed = client.get(
        "/api/connect/gmail/callback", params={"state": _start(client), "code": "c"}
    )

    assert "gmail=error" in failed.headers["location"]
    assert not env_path.exists()


def test_an_unknown_referer_is_not_redirected_to(client: TestClient) -> None:
    response = client.get("/api/connect/gmail", headers={"referer": "https://evil.example/"})
    state = parse_qs(urlsplit(response.headers["location"]).query)["state"][0]

    done = client.get("/api/connect/gmail/callback", params={"state": state, "error": "x"})

    assert done.headers["location"].startswith("/#/setup")


def test_connect_needs_an_oauth_client(
    engine: Engine, settings: Settings, services: Services
) -> None:
    with TestClient(create_app(settings, services)) as client:
        assert client.get("/api/connect/gmail").status_code == 409
