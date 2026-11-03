"""Connectors run together, one failure never stops the rest, and only one cycle runs at once."""

import asyncio
import dataclasses
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.orm import Session, sessionmaker

from recoup.api.app import create_app
from recoup.config import REPO_ROOT, Settings
from recoup.connectors.base import ConnectorError, Kind
from recoup.connectors.registry import StatusPagesConnector, build_connectors, sync_all
from recoup.connectors.scheduler import BackgroundSync
from recoup.db.session import session_scope
from recoup.ingest.live import snapshot_fetcher
from recoup.ingest.sources import Sources
from recoup.services import Services
from tests.conftest import load_and_run

SNAPSHOT = REPO_ROOT / "data" / "live" / "status_snapshot"


@dataclass
class FakeConnector:
    key: str
    kind: Kind = "ledger"
    is_configured: bool = True
    error: str | None = None
    calls: list[int] = field(default_factory=list)

    def sync(self, session: Session) -> dict[str, Any]:
        self.calls.append(1)
        if self.error:
            raise ConnectorError(self.error)
        return {"inserted": 3}


def background(
    factory: sessionmaker[Session],
    settings: Settings,
    services: Services,
    sources: Sources,
    *connectors: FakeConnector,
) -> BackgroundSync:
    return BackgroundSync(factory, settings, services, sources, connectors, interval_seconds=0)


def test_one_failing_connector_does_not_stop_the_others(
    session_factory: sessionmaker[Session],
) -> None:
    broken = FakeConnector("ramp", error="Ramp kept returning 503. Try again shortly.")
    mail = FakeConnector("gmail", kind="email")
    off = FakeConnector("other", is_configured=False)
    with session_scope(session_factory) as session:
        outcomes = sync_all(session, [broken, mail, off])

    assert [(o.connector, o.ok) for o in outcomes] == [("ramp", False), ("gmail", True)]
    assert outcomes[0].error == "Ramp kept returning 503. Try again shortly."
    assert outcomes[1].detail == {"inserted": 3}
    assert not off.calls


def test_an_unexpected_error_is_not_swallowed(session_factory: sessionmaker[Session]) -> None:
    class Crashing(FakeConnector):
        def sync(self, session: Session) -> dict[str, Any]:
            raise RuntimeError("bug")

    with session_scope(session_factory) as session, pytest.raises(RuntimeError):
        sync_all(session, [Crashing("ramp")])


def test_the_shipped_connectors_cover_ledger_mail_and_status(
    settings: Settings, sources: Sources
) -> None:
    connectors = build_connectors(settings, sources)

    assert [(c.key, c.kind, c.is_configured) for c in connectors] == [
        ("ramp", "ledger", False),
        ("gmail", "email", False),
        ("status_pages", "status", True),
    ]


def test_status_pages_connector_reports_each_feed(session_factory: sessionmaker[Session]) -> None:
    connector = StatusPagesConnector(fetch=snapshot_fetcher(SNAPSHOT), origin="snapshot")
    with session_scope(session_factory) as session:
        detail = connector.sync(session)

    assert detail == {"feeds_ok": 3, "feeds_failed": []}


def test_a_cycle_syncs_then_detects(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    sync = background(session_factory, settings, services, sources, FakeConnector("ramp"))
    report = sync.run_once()

    assert report is not None and sync.last_report is report
    assert [o.connector for o in report.outcomes] == ["ramp"]
    assert report.run.transactions > 0


def test_only_one_cycle_runs_at_a_time(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    sync = background(session_factory, settings, services, sources)
    with sync._lock:
        assert sync.is_running
        assert sync.run_once() is None


def test_a_failed_cycle_is_remembered_by_type_only(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    class Crashing(FakeConnector):
        def sync(self, session: Session) -> dict[str, Any]:
            raise RuntimeError("token=shhh")

    sync = background(session_factory, settings, services, sources, Crashing("ramp"))
    with pytest.raises(RuntimeError):
        sync.run_once()

    assert sync.last_error == "RuntimeError" and not sync.is_running


def test_the_timer_survives_a_bad_cycle_and_stops_when_cancelled(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    sync = background(session_factory, settings, services, sources)
    sync.interval_seconds = 0.01
    calls: list[int] = []

    def flaky() -> None:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("first cycle fails")

    sync.run_once = flaky  # type: ignore[method-assign]

    async def run() -> None:
        task = asyncio.create_task(sync.run_forever())
        while len(calls) < 3:
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(asyncio.wait_for(run(), timeout=5))
    assert len(calls) >= 3


@pytest.fixture
def client(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> Any:
    load_and_run(session_factory, settings, services, sources)
    app = create_app(settings, services)
    with TestClient(app) as client:
        context = app.state.context
        sync = background(context.factory, settings, services, sources, FakeConnector("ramp"))
        app.state.context = dataclasses.replace(context, sync=sync)
        yield client


def test_sync_endpoint_runs_a_cycle(client: TestClient) -> None:
    response = client.post("/api/sync")

    assert response.status_code == 200
    body = response.json()
    assert body["outcomes"] == [
        {
            "connector": "ramp",
            "kind": "ledger",
            "ok": True,
            "detail": {"inserted": 3},
            "error": None,
        }
    ]
    assert body["run"]["transactions"] > 0
    sources = client.get("/api/sources").json()
    assert sources["background_sync"]["last_finished_at"] == body["finished_at"]


def test_sync_endpoint_refuses_to_overlap(client: TestClient) -> None:
    sync: BackgroundSync = client.app.state.context.sync  # type: ignore[attr-defined]
    with sync._lock:
        response = client.post("/api/sync")

    assert response.status_code == 409
    assert response.json()["detail"] == "A sync is already running."


def test_sources_lists_every_connector_without_secrets(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    ready = settings.model_copy(
        update={
            "gmail_client_id": "id",
            "gmail_client_secret": SecretStr("client-shhh"),
            "gmail_refresh_token": SecretStr("refresh-shhh"),
        }
    )
    with TestClient(create_app(ready, services)) as client:
        response = client.get("/api/sources")

    body = response.json()
    assert body["gmail"] == {"connected": True, "last_sync": None}
    assert [(c["key"], c["configured"]) for c in body["connectors"]] == [
        ("ramp", False),
        ("gmail", True),
        ("status_pages", True),
    ]
    assert body["background_sync"] == {
        "interval_minutes": 0,
        "running": False,
        "last_finished_at": None,
        "last_error": None,
    }
    assert "shhh" not in response.text
