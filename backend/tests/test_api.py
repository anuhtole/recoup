from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.orm import Session, sessionmaker

from recoup.api.app import create_app
from recoup.config import Settings
from recoup.ingest.sources import Sources
from recoup.services import Services
from tests.conftest import load_and_run


@pytest.fixture
def client(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> Iterator[TestClient]:
    load_and_run(session_factory, settings, services, sources)
    with TestClient(create_app(settings, services)) as client:
        yield client


def _todo(client: TestClient, kind: str = "draft") -> list[dict[str, Any]]:
    findings = client.get("/api/findings", params={"stage": "todo"}).json()
    return [f for f in findings if f["next_action"]["kind"] == kind]


def _draft_and_send(client: TestClient, finding_id: int) -> dict[str, Any]:
    draft = client.post(f"/api/findings/{finding_id}/draft").json()
    sent = client.post(
        f"/api/drafts/{draft['id']}/send", json={"confirm": True, "approver": "dana"}
    )
    assert sent.status_code == 200, sent.text
    result: dict[str, Any] = sent.json()
    return result


def test_health(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_summary_splits_money_by_where_it_stands(client: TestClient) -> None:
    summary = client.get("/api/summary").json()

    assert summary["as_of"] == "2026-10-01"
    assert summary["mode"] == "offline"
    assert summary["data_mode"] == "demo"
    assert summary["claimable_minor"] > 0
    assert summary["expired_minor"] >= 3_748
    assert (summary["in_flight_minor"], summary["recovered_minor"]) == (0, 0)


def test_summary_counts_unsent_cases_past_their_deadline_as_missed(client: TestClient) -> None:
    summary = client.get("/api/summary").json()
    todo = client.get("/api/findings", params={"stage": "todo"}).json()
    past = [f for f in todo if f["days_left"] is not None and f["days_left"] < 0]
    open_window = [f for f in todo if f not in past]

    assert past, "the demo world should have cases whose claim window already closed"
    assert summary["claimable_minor"] == sum(f["amount_minor"] for f in open_window)
    assert summary["expired_minor"] == 3_748 + sum(f["amount_minor"] for f in past)


def test_queue_puts_the_soonest_open_deadline_first(client: TestClient) -> None:
    findings = client.get("/api/findings", params={"stage": "todo"}).json()
    days = [f["days_left"] for f in findings if f["days_left"] is not None]
    still_open = [d for d in days if d >= 0]

    assert days[: len(still_open)] == sorted(still_open)  # open deadlines first, soonest on top
    assert all(d < 0 for d in days[len(still_open) :])  # then ones already past
    assert {f["stage"] for f in findings} == {"todo"}


def test_detail_tells_the_story_with_evidence(client: TestClient) -> None:
    sla = next(f for f in client.get("/api/findings").json() if f["leak_type"] == "sla_credit")

    detail = client.get(f"/api/findings/{sla['id']}").json()

    assert {e["kind"] for e in detail["evidence"]} >= {"contract", "incident", "transaction"}
    kinds = [event["kind"] for event in detail["timeline"]]
    assert kinds[0] in ("incident", "charge") and "detected" in kinds
    assert detail["trace"][0]["action"] == "finding.created"


def test_sending_requires_explicit_confirmation(client: TestClient) -> None:
    finding = _todo(client)[0]
    draft = client.post(f"/api/findings/{finding['id']}/draft").json()

    assert client.post(f"/api/drafts/{draft['id']}/send", json={}).status_code == 422
    assert (
        client.post(f"/api/drafts/{draft['id']}/send", json={"confirm": False}).status_code == 422
    )
    assert client.get(f"/api/findings/{finding['id']}").json()["status"] == "drafted"


def test_draft_can_be_edited_until_sent(client: TestClient) -> None:
    finding = _todo(client)[0]
    draft = client.post(f"/api/findings/{finding['id']}/draft").json()

    edited = client.patch(f"/api/drafts/{draft['id']}", json={"subject": "Hi", "body": "Edited."})
    assert edited.json()["body"] == "Edited."
    client.post(f"/api/drafts/{draft['id']}/send", json={"confirm": True})
    again = client.patch(f"/api/drafts/{draft['id']}", json={"subject": "Hi", "body": "Later"})
    assert again.status_code == 409


def test_invalid_transitions_are_conflicts(client: TestClient) -> None:
    expired = next(f for f in client.get("/api/findings").json() if f["status"] == "expired")

    assert client.post(f"/api/findings/{expired['id']}/draft").status_code == 409
    assert client.post("/api/findings/999999/draft").status_code == 404
    assert (
        client.post(f"/api/findings/{expired['id']}/dismiss", json={"reason": ""}).status_code
        == 422
    )


def test_demo_controls_are_off_unless_enabled(
    session_factory: sessionmaker[Session], settings: Settings, services: Services
) -> None:
    app = create_app(settings.model_copy(update={"demo_mode": False}), services)
    with TestClient(app) as production:
        assert production.post("/api/demo/advance", json={"days": 14}).status_code == 404


def test_full_loop_from_finding_to_money_back(client: TestClient) -> None:
    for finding in _todo(client):
        _draft_and_send(client, finding["id"])
    assert client.get("/api/summary").json()["in_flight_minor"] > 0

    first = client.post("/api/demo/advance", json={"days": 14}).json()
    assert first["as_of"] == "2026-10-15"
    assert first["replies"] > 0 and first["run"]["recovered"] > 0

    for kind in ("follow_up", "escalate", "draft"):
        for finding in _todo(client, kind):
            _draft_and_send(client, finding["id"])
    for _ in range(2):
        client.post("/api/demo/advance", json={"days": 14})
        for kind in ("follow_up", "escalate", "draft"):
            for finding in _todo(client, kind):
                _draft_and_send(client, finding["id"])

    summary = client.get("/api/summary").json()
    findings = client.get("/api/findings").json()
    assert {f["status"] for f in findings} == {"recovered", "expired"}
    assert summary["recovered_minor"] == sum(
        f["recovered_minor"] for f in findings if f["status"] == "recovered"
    )
    closed = next(f for f in findings if f["status"] == "recovered")
    timeline = client.get(f"/api/findings/{closed['id']}").json()["timeline"]
    assert [e["kind"] for e in timeline][-3:] == ["reply", "charge", "recovered"]


def test_sources_reports_connections_without_exposing_credentials(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    secret = SecretStr("do-not-return-this")
    ready = settings.model_copy(update={"ramp_client_id": "id", "ramp_client_secret": secret})
    with TestClient(create_app(ready, services)) as client:
        response = client.get("/api/sources")

    assert response.json()["ramp"] == {
        "connected": True,
        "environment": "sandbox",
        "last_sync": None,
    }
    assert {f["key"] for f in response.json()["status_feeds"]} == {"jira", "confluence", "github"}
    assert "do-not-return-this" not in response.text


def test_ramp_sync_without_credentials_is_a_clear_conflict(client: TestClient) -> None:
    response = client.post("/api/sync/ramp")

    assert response.status_code == 409
    assert response.json()["detail"] == "Ramp is not connected."


def test_data_mode_is_live_without_a_bundled_ledger(tmp_path: Path) -> None:
    # The live data directory has vendors and a status snapshot, but no transactions file.
    (tmp_path / "vendors.json").write_text("[]")
    assert Settings(data_dir=tmp_path).data_mode == "live"
