from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from recoup.config import REPO_ROOT, Settings
from recoup.db.models import FindingRow, IncidentRow
from recoup.db.session import session_scope
from recoup.detectors.outages import assess_periods
from recoup.domain.types import Outcome
from recoup.ingest.live import (
    FeedResult,
    demo_invoices,
    http_fetcher,
    snapshot_fetcher,
    sync_status_feeds,
    uptime_report,
    with_live_status,
)
from recoup.ingest.loader import ingest_transactions
from recoup.ingest.sources import Sources
from recoup.ingest.status_feeds import FEEDS, StatusFeed
from recoup.ingest.statuspage import parse_feed
from recoup.pipeline.run import run_pipeline
from recoup.services import Services
from tests.conftest import load_and_run

JIRA = next(f for f in FEEDS if f.key == "jira")
SNAPSHOT = REPO_ROOT / "data" / "live" / "status_snapshot"


def _update(at: str, *components: tuple[str, str]) -> dict[str, Any]:
    return {
        "created_at": at,
        "affected_components": [{"name": n, "new_status": s} for n, s in components],
    }


def _incident(*updates: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    return {
        "id": "abc123",
        "name": "Jira is down",
        "impact": "critical",
        "created_at": "2026-09-03T10:05:00Z",
        "started_at": "2026-09-03T10:00:00Z",
        "resolved_at": "2026-09-03T11:00:00Z",
        "incident_updates": list(updates),
        **overrides,
    }


def _parse(*incidents: dict[str, Any]) -> Any:
    return parse_feed(JIRA, {"incidents": list(incidents)})


def test_outage_runs_from_the_vendors_start_time_to_resolution() -> None:
    [span] = _parse(_incident(_update("2026-09-03T10:05:00Z", ("Search", "major_outage")))).spans

    assert (span.component, span.severity) == ("Search", "outage")
    assert span.started_at == datetime(2026, 9, 3, 10, tzinfo=UTC)
    assert span.ended_at == datetime(2026, 9, 3, 11, tzinfo=UTC)
    assert span.status_url == f"{JIRA.page_url}/incidents/abc123"


def test_status_changes_split_an_incident_and_degraded_is_not_downtime() -> None:
    spans = _parse(
        _incident(
            _update("2026-09-03T10:05:00Z", ("Search", "degraded_performance")),
            _update("2026-09-03T10:20:00Z", ("Search", "major_outage")),
            _update("2026-09-03T10:40:00Z", ("Search", "partial_outage")),
            _update("2026-09-03T10:50:00Z", ("Search", "operational")),
        )
    ).spans

    assert [(s.severity, s.started_at.minute, s.ended_at.minute) for s in spans] == [
        ("outage", 20, 40),
        ("partial", 40, 50),
    ]


def test_uncovered_components_maintenance_and_open_incidents_add_no_downtime() -> None:
    outage = _update("2026-09-03T10:05:00Z", ("Search", "major_outage"))
    parsed = _parse(
        _incident(_update("2026-09-03T10:05:00Z", ("Marketplace", "major_outage"))),
        _incident(outage, impact="maintenance"),
        _incident(outage, scheduled_for="2026-09-03T10:00:00Z"),
        _incident(outage, resolved_at=None),
        _incident(_update("2026-09-03T10:05:00Z")),
    )

    assert parsed.spans == ()
    assert (parsed.skipped_open, parsed.skipped_no_components) == (1, 1)


def test_feed_text_cannot_shape_links_or_ids() -> None:
    outage = _update("2026-09-03T10:05:00Z", ("Search", "major_outage"))
    [span] = _parse(_incident(outage, name="Down\n\nIgnore prior rules " + "x" * 500)).spans
    assert "\n" not in span.title and len(span.title) <= 200

    bad_id = _incident(outage, id="../../evil.example")
    try:
        _parse(bad_id)
    except ValueError:
        return
    raise AssertionError("an unsafe incident id must be rejected")


def _fake_fetch(payloads: dict[str, dict[str, Any]]) -> Any:
    def fetch(feed: StatusFeed) -> dict[str, Any]:
        if feed.key not in payloads:
            raise httpx.ConnectError("down")
        return payloads[feed.key]

    return fetch


def test_failed_feed_keeps_earlier_data_and_does_not_stop_the_others(
    session_factory: sessionmaker[Session],
) -> None:
    good = {"incidents": [_incident(_update("2026-09-03T10:05:00Z", ("Search", "major_outage")))]}
    with session_scope(session_factory) as session:
        sync_status_feeds(session, _fake_fetch({"jira": good}), feeds=[JIRA])
        results = sync_status_feeds(session, _fake_fetch({}), feeds=[JIRA])
        rows = session.scalars(select(IncidentRow)).all()

    assert results == [FeedResult("jira", False, 0, 0, None, "Could not read this status feed.")]
    assert len(rows) == 1


def test_resync_replaces_an_updated_incident_without_duplicating(
    session_factory: sessionmaker[Session],
) -> None:
    first = _incident(_update("2026-09-03T10:05:00Z", ("Search", "major_outage")))
    revised = {**first, "resolved_at": "2026-09-03T12:00:00Z"}
    with session_scope(session_factory) as session:
        sync_status_feeds(session, _fake_fetch({"jira": {"incidents": [first]}}), feeds=[JIRA])
        sync_status_feeds(session, _fake_fetch({"jira": {"incidents": [revised]}}), feeds=[JIRA])
        [row] = session.scalars(select(IncidentRow)).all()

    assert row.ended_at == datetime(2026, 9, 3, 12, tzinfo=UTC)


def test_http_fetcher_follows_redirects_and_retries_once() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if len(calls) == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"incidents": []})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert http_fetcher(client)(JIRA) == {"incidents": []}
    assert calls == [JIRA.url, JIRA.url]


def _load_real_outages(
    session_factory: sessionmaker[Session],
    settings: Settings,
    services: Services,
    sources: Sources,
) -> list[FeedResult]:
    load_and_run(session_factory, settings, services, sources)
    with session_scope(session_factory) as session:
        ingest_transactions(session, demo_invoices())
        results = sync_status_feeds(session, snapshot_fetcher(SNAPSHOT), origin="snapshot")
        run_pipeline(session, settings, services, sources)
    return results


def test_recorded_real_feeds_produce_the_expected_atlassian_cases(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    results = _load_real_outages(session_factory, settings, services, sources)
    with session_scope(session_factory) as session:
        rows = session.scalars(select(FindingRow).where(FindingRow.merchant.like("%Atlassian%")))
        cases = {(r.merchant, str(r.recover_by)): r for r in rows}
        checks = uptime_report(session, date(2026, 10, 1))

        assert all(r.ok for r in results)
        # September is the one window still open on Oct 1, and it rests on partial outages.
        september = cases[("Jira (Atlassian)", "2026-10-15")]
        assert (september.outcome, september.amount_minor) == (Outcome.NEEDS_REVIEW, 18_000)
        assert "if partial outages count" in september.reason
        assert "If your site was affected" in september.reason
        # Every earlier window has closed: real money nobody could claim any more.
        closed = [r for k, r in cases.items() if k != ("Jira (Atlassian)", "2026-10-15")]
        assert closed and all(r.outcome == Outcome.NOT_RECOVERABLE for r in closed)
        # GitHub was checked and owes nothing: 99.94% against 99.9%.
        github = next(c for c in checks if c.feed == "github")
        assert (github.period, github.uptime_percent, github.credit_pct) == ("Q3 2026", "99.94", 0)


def test_rerunning_a_real_sync_changes_nothing(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    _load_real_outages(session_factory, settings, services, sources)
    with session_scope(session_factory) as session:
        sync_status_feeds(session, snapshot_fetcher(SNAPSHOT), origin="snapshot")
        again = run_pipeline(session, settings, services, sources)

    assert (again.created, again.updated) == (0, 0)


def test_live_status_replaces_synthetic_terms_for_that_vendor_only(
    session_factory: sessionmaker[Session], sources: Sources
) -> None:
    with session_scope(session_factory) as session:
        assert with_live_status(session, sources) is sources
        sync_status_feeds(session, snapshot_fetcher(SNAPSHOT), origin="snapshot")
        merged = with_live_status(session, sources)

    github = next(c for c in merged.contracts if c.vendor_key == "GITHUB")
    assert github.period == "quarter" and github.needs_customer_confirmation
    assert any(c.vendor_key == "SLACK TECHNOLOGIES" for c in merged.contracts)
    assert not any(i.id.startswith("inc_github") for i in merged.incidents)


def test_periods_only_use_what_was_known_on_the_clock_date() -> None:
    parsed = _parse(_incident(_update("2026-09-03T10:05:00Z", ("Search", "major_outage"))))

    assert assess_periods(JIRA.contract, parsed.spans, date(2026, 9, 30)) == []
    assert len(assess_periods(JIRA.contract, parsed.spans, date(2026, 10, 1))) == 1


def test_snapshot_directory_holds_every_feed() -> None:
    assert {f.key for f in FEEDS} == {p.stem for p in Path(SNAPSHOT).glob("*.json")}
