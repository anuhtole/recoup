"""The scripted demo: clean slate, staged Gmail, scan on demand, and the two-weeks story."""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from recoup.api.app import create_app
from recoup.config import Settings
from recoup.services import Services

# The original demo world, in /api/findings order.
FINDING_IDS = [2, 7, 1, 17, 18, 20, 3, 15, 8, 14, 9, 16, 10, 11, 12, 4, 5, 13, 6, 19]
OPEN_TODO_IDS = FINDING_IDS[:15]
URGENT = [
    (2, "Figma", 48_000),
    (1, "WeWork", 420_000),
    (17, "Amazon Web Services", 38_571),
    (18, "Slack", 10_938),
    (20, "Figma", 14_400),
]


@pytest.fixture
def client(
    session_factory: sessionmaker[Session], settings: Settings, services: Services
) -> Iterator[TestClient]:
    with TestClient(create_app(settings, services)) as client:
        assert client.post("/api/demo/reset").json() == {"ok": True}
        yield client


def _ok(response: Any) -> Any:
    assert response.status_code == 200, response.text
    return response.json()


def _connect_and_scan(client: TestClient) -> dict[str, Any]:
    _ok(client.post("/api/demo/connect", json={"source": "gmail"}))
    result: dict[str, Any] = _ok(client.post("/api/demo/scan"))
    return result


def _assert_clean(client: TestClient) -> None:
    assert _ok(client.get("/api/findings")) == []
    summary = _ok(client.get("/api/summary"))
    assert summary["as_of"] == "2026-10-01"
    assert (summary["claimable_minor"], summary["in_flight_minor"]) == (0, 0)
    assert (summary["recovered_minor"], summary["expired_minor"]) == (0, 0)
    assert all(t["count"] == 0 for t in summary["totals"])
    assert all(s["count"] == 0 for s in summary["stages"])
    assert _ok(client.get("/api/demo/state")) == {
        "scanned": False,
        "gmail_connected": False,
        "gmail_address": "finance@acme.com",
        "as_of": "2026-10-01",
        "start_as_of": "2026-10-01",
    }
    sources = _ok(client.get("/api/sources"))
    assert sources["ramp"]["connected"] is True
    assert sources["ramp"]["last_sync"]["ok"] is True
    assert sources["ramp"]["last_sync"]["detail"]["pulled"] > 0
    assert sources["gmail"] == {
        "connected": False,
        "sends_approved_mail": False,
        "last_sync": None,
    }
    configured = {c["key"]: c["configured"] for c in sources["connectors"]}
    assert configured == {"ramp": True, "gmail": False, "status_pages": True}


def test_reset_is_a_clean_slate_with_the_ledger_in(client: TestClient) -> None:
    _assert_clean(client)


def test_scan_needs_gmail(client: TestClient) -> None:
    response = client.post("/api/demo/scan")

    assert response.status_code == 409
    assert "Gmail" in response.json()["detail"]
    assert _ok(client.get("/api/findings")) == []


def test_connect_is_staged_persisted_and_idempotent(client: TestClient) -> None:
    first = _ok(client.post("/api/demo/connect", json={"source": "gmail"}))
    second = _ok(client.post("/api/demo/connect", json={"source": "gmail"}))

    assert first["gmail"]["connected"] is True and second["gmail"]["connected"] is True
    assert _ok(client.get("/api/sources"))["gmail"]["connected"] is True
    assert _ok(client.get("/api/demo/state"))["gmail_connected"] is True
    assert client.post("/api/demo/connect", json={"source": "ramp"}).status_code == 422


def test_scan_builds_the_original_world_once(client: TestClient) -> None:
    first = _connect_and_scan(client)
    second = _ok(client.post("/api/demo/scan"))

    assert first["created"] == 20 and first["emails_read"] > 0
    assert second["created"] == 0 and second["unchanged"] == 20
    assert _ok(client.get("/api/demo/state"))["scanned"] is True
    assert _ok(client.get("/api/sources"))["gmail"]["last_sync"]["ok"] is True

    findings = _ok(client.get("/api/findings"))
    assert [f["id"] for f in findings] == FINDING_IDS
    todo = [f for f in findings if f["status"] == "open" and (f["days_left"] or 0) >= 0]
    assert [f["id"] for f in todo] == OPEN_TODO_IDS
    assert sum(f["amount_minor"] for f in todo) == 1_371_009
    assert (todo[0]["merchant"], todo[0]["amount_minor"], todo[0]["days_left"]) == (
        "Figma",
        48_000,
        1,
    )
    urgent = [f for f in todo if f["days_left"] <= 30]
    assert sum(f["amount_minor"] for f in urgent) == 538_329
    recoverable = [
        (f["id"], f["merchant"], f["amount_minor"]) for f in urgent if f["outcome"] == "recoverable"
    ]
    assert recoverable == URGENT
    missed = [f for f in findings if f not in todo]
    assert sum(f["amount_minor"] for f in missed) == 143_273
    assert sum(f["status"] == "expired" for f in missed) == 1
    summary = _ok(client.get("/api/summary"))
    assert (summary["in_flight_minor"], summary["recovered_minor"]) == (0, 0)


def test_reset_and_scan_give_the_same_ids_every_time(client: TestClient) -> None:
    _connect_and_scan(client)
    first = [(f["id"], f["merchant"], f["amount_minor"]) for f in _ok(client.get("/api/findings"))]
    draft = _ok(client.post("/api/findings/2/draft"))
    _ok(client.post("/api/demo/reset"))
    _connect_and_scan(client)
    again = [(f["id"], f["merchant"], f["amount_minor"]) for f in _ok(client.get("/api/findings"))]

    assert again == first
    assert _ok(client.post("/api/findings/2/draft"))["id"] == draft["id"] == 1


def test_two_weeks_later_tells_the_scripted_story(client: TestClient) -> None:
    _connect_and_scan(client)
    for finding_id, _, _ in URGENT:
        draft = _ok(client.post(f"/api/findings/{finding_id}/draft"))
        sent = _ok(client.post(f"/api/drafts/{draft['id']}/send", json={"confirm": True}))
        assert sent["status"] == "sent"

    advanced = _ok(client.post("/api/demo/advance", json={"days": 14}))
    findings = {f["id"]: f for f in _ok(client.get("/api/findings"))}
    status = {merchant_amount[1:]: findings[merchant_amount[0]] for merchant_amount in URGENT}

    assert advanced["as_of"] == "2026-10-15"
    assert {k: v["status"] for k, v in status.items()} == {
        ("Figma", 48_000): "recovered",
        ("WeWork", 420_000): "recovered",
        ("Slack", 10_938): "recovered",
        ("Amazon Web Services", 38_571): "vendor_agreed",
        ("Figma", 14_400): "sent",
    }
    assert _ok(client.get("/api/summary"))["recovered_minor"] == 478_938
    assert _ok(client.get("/api/demo/state"))["as_of"] == "2026-10-15"

    # A second jump may finish the two slow ones.
    _ok(client.post("/api/demo/advance", json={"days": 14}))
    later = {f["id"]: f["status"] for f in _ok(client.get("/api/findings"))}
    assert later[17] == "recovered" and later[20] == "recovered"


def test_reset_mid_demo_returns_to_the_clean_slate(client: TestClient) -> None:
    _connect_and_scan(client)
    draft = _ok(client.post("/api/findings/2/draft"))
    _ok(client.post(f"/api/drafts/{draft['id']}/send", json={"confirm": True}))
    _ok(client.post("/api/demo/advance", json={"days": 14}))

    assert _ok(client.post("/api/demo/reset")) == {"ok": True}
    _assert_clean(client)


def test_history_stays_off_on_scan_by_default(client: TestClient) -> None:
    _connect_and_scan(client)

    assert len(_ok(client.get("/api/findings"))) == 20
    assert _ok(client.get("/api/summary"))["recovered_minor"] == 0


def test_demo_routes_are_off_unless_enabled(
    session_factory: sessionmaker[Session], settings: Settings, services: Services
) -> None:
    app = create_app(settings.model_copy(update={"demo_mode": False}), services)
    with TestClient(app) as production:
        assert production.get("/api/demo/state").status_code == 404
        assert production.post("/api/demo/reset").status_code == 404
        assert production.post("/api/demo/scan").status_code == 404
        connect = production.post("/api/demo/connect", json={"source": "gmail"})
        assert connect.status_code == 404
        assert production.get("/api/sources").json()["ramp"]["connected"] is False


def test_findings_are_dated_by_the_demo_clock(client: TestClient) -> None:
    """The wall clock is weeks past the demo's dates; no claim is flagged after its credit."""
    _connect_and_scan(client)
    findings = _ok(client.get("/api/findings"))
    assert findings
    assert {f["created_at"] for f in findings} == {"2026-10-01T12:00:00Z"}

    _ok(client.post("/api/demo/advance", json={"days": 14}))
    after = _ok(client.get("/api/findings"))
    later = [f for f in after if f["created_at"] != "2026-10-01T12:00:00Z"]
    assert all(f["created_at"] == "2026-10-15T12:00:00Z" for f in later)


def test_nothing_detects_before_the_scan(client: TestClient) -> None:
    """Run detection, Sync and Advance are in the UI; none may run on the clean slate."""
    for path, body in (
        ("/api/pipeline/run", None),
        ("/api/sync", None),
        ("/api/demo/advance", {"days": 14}),
    ):
        response = client.post(path, json=body)
        assert response.status_code == 409, path
        assert "scan" in response.json()["detail"].lower()
    _assert_clean(client)

    # Once scanned they work, and the ids are the scripted ones.
    _connect_and_scan(client)
    assert client.post("/api/pipeline/run").status_code == 200
    synced = _ok(client.post("/api/sync"))
    assert [o["connector"] for o in synced["outcomes"]] == ["ramp", "gmail"]
    assert synced["run"]["created"] == 0
    assert [f["id"] for f in _ok(client.get("/api/findings"))][:6] == [2, 7, 1, 17, 18, 20]


def test_a_send_on_the_demo_clock_is_after_the_claim_was_flagged(client: TestClient) -> None:
    """Whatever hour the demo runs, the case timeline reads flagged, drafted, sent."""
    _connect_and_scan(client)
    draft = _ok(client.post("/api/findings/2/draft"))
    _ok(client.post(f"/api/drafts/{draft['id']}/send", json={"confirm": True}))
    detail = _ok(client.get("/api/findings/2"))
    kinds = [e["kind"] for e in detail["timeline"] if e["kind"] in ("detected", "drafted", "sent")]
    assert kinds == ["detected", "drafted", "sent"]
    sent_at = detail["drafts"][0]["sent_at"]
    assert sent_at.startswith("2026-10-01T") and sent_at[11:13] >= "13"
