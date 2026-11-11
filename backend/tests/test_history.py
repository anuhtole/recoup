from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from recoup.api.app import create_app
from recoup.config import Settings
from recoup.db.models import AuditEventRow, DraftRow, EmailRow, FindingRow, TransactionRow
from recoup.db.session import session_scope
from recoup.demo import history
from recoup.demo.history import HistorySummary, replay_history
from recoup.demo.simulator import advance
from recoup.domain.workflow import Status
from recoup.ingest.sources import Sources
from recoup.services import Services
from tests.conftest import load_and_run

# Eight claims won before the demo starts; the AWS invoice is $3,904.09 on the default seed.
RECOVERED_MINOR = 1_103_055
# Five more are out: two unanswered and two agreed are waiting; one came back with a question.
IN_FLIGHT_MINOR = 91_200 + 137_445 + 184_732 + 74_792
INFO_REQUESTED_MINOR = 32_640


@pytest.fixture
def settings(settings: Settings) -> Settings:
    """The history is opt-in (RECOUP_DEMO_HISTORY=true); these tests turn it on."""
    return settings.model_copy(update={"demo_history": True})


def test_history_is_off_by_default(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    default = settings.model_copy(update={"demo_history": False})

    assert _replay(session_factory, default, services, sources) is None


def _replay(
    factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> HistorySummary | None:
    with session_scope(factory) as session:
        return replay_history(session, settings, services, sources)


def _snapshot(factory: sessionmaker[Session]) -> dict[int, dict[str, Any]]:
    with session_scope(factory) as session:
        return {
            row.id: {
                "key": row.key,
                "status": row.status,
                "outcome": row.outcome,
                "amount_minor": row.amount_minor,
                "recover_by": row.recover_by,
                "reason": row.reason,
                "transaction_ids": row.transaction_ids,
                "evidence": row.evidence,
            }
            for row in session.scalars(select(FindingRow))
        }


def test_past_claims_close_only_on_a_ledger_credit(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)

    summary = _replay(session_factory, settings, services, sources)

    assert summary is not None
    assert (summary.claims, summary.recovered, summary.recovered_minor) == (13, 8, RECOVERED_MINOR)
    assert (summary.in_flight, summary.in_flight_minor) == (4, IN_FLIGHT_MINOR)
    assert (summary.run.created, summary.run.updated, summary.run.recovered) == (0, 0, 8)
    with session_scope(session_factory) as session:
        recovered = session.scalars(
            select(FindingRow).where(FindingRow.status == Status.RECOVERED)
        ).all()
        assert len(recovered) == 8
        for row in recovered:
            credit = session.get(TransactionRow, row.recovered_txn_id)
            assert credit is not None and -credit.amount_minor == row.recovered_minor
            assert row.recovered_minor == row.amount_minor
            assert row.recovered_at == credit.posted_at
            sent = session.scalars(select(DraftRow).where(DraftRow.finding_id == row.id)).one()
            assert sent.status == "sent" and sent.sent_at is not None
            assert row.created_at < sent.sent_at < credit.posted_at
            actions = session.scalars(
                select(AuditEventRow.action)
                .where(AuditEventRow.finding_id == row.id)
                .order_by(AuditEventRow.id)
            ).all()
            assert list(actions) == [
                "finding.created",
                "draft.created",
                "message.sent",
                "vendor.replied",
                "recovery.confirmed",
            ]


def test_history_spans_vendors_leak_types_and_months(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    _replay(session_factory, settings, services, sources)

    with session_scope(session_factory) as session:
        recovered = session.scalars(
            select(FindingRow).where(FindingRow.status == Status.RECOVERED)
        ).all()

    assert {row.merchant for row in recovered} == {
        "Amazon",
        "Amazon Web Services",
        "Calendly",
        "Dell Technologies",
        "Google Workspace",
        "Linear",
        "Staples",
        "WeWork",
    }
    assert {row.leak_type for row in recovered} == {
        "duplicate_charge",
        "missing_refund",
        "charged_after_cancellation",
    }
    months = {row.recovered_at.month for row in recovered if row.recovered_at}
    assert months == {6, 7, 8, 9}


def test_history_leaves_open_claims_as_they_were(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    before = _snapshot(session_factory)

    _replay(session_factory, settings, services, sources)
    after = _snapshot(session_factory)

    assert {key: after[key] for key in before} == before
    assert len(after) == len(before) + 13


def test_history_is_replayed_once(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    _replay(session_factory, settings, services, sources)
    first = _snapshot(session_factory)

    assert _replay(session_factory, settings, services, sources) is None
    assert _snapshot(session_factory) == first


def test_summary_shows_the_money_already_back(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    with TestClient(create_app(settings, services)) as client:
        before = client.get("/api/summary").json()
        _replay(session_factory, settings, services, sources)
        after = client.get("/api/summary").json()
        findings = client.get("/api/findings", params={"stage": "done"}).json()

    assert (before["recovered_minor"], after["recovered_minor"]) == (0, RECOVERED_MINOR)
    assert (before["in_flight_minor"], after["in_flight_minor"]) == (0, IN_FLIGHT_MINOR)
    # A vendor's question puts the claim back in the reviewer's queue, so it counts as claimable.
    assert after["claimable_minor"] == before["claimable_minor"] + INFO_REQUESTED_MINOR
    for unchanged in ("expired_minor", "as_of"):
        assert after[unchanged] == before[unchanged]
    closed = [f for f in findings if f["status"] == "recovered"]
    assert sum(f["recovered_minor"] for f in closed) == RECOVERED_MINOR
    assert all(f["recovered_at"] < "2026-10-01" and f["days_left"] is None for f in closed)


def test_in_flight_claims_stop_where_the_vendor_left_them(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    _replay(session_factory, settings, services, sources)
    with TestClient(create_app(settings, services)) as client:
        findings = {f["merchant"]: f for f in client.get("/api/findings").json() if f["id"] > 28}
        notion = client.get(f"/api/findings/{findings['Notion']['id']}").json()
        datadog = client.get(f"/api/findings/{findings['Datadog']['id']}").json()

    assert {
        name: (f["status"], f["stage"], f["next_action"]["kind"], f["next_action"]["label"])
        for name, f in findings.items()
    } == {
        "GitHub": ("sent", "waiting", "follow_up", "No reply in 18 days; follow up"),
        "Zendesk": ("sent", "waiting", "wait", "Waiting on the vendor"),
        "Notion": ("info_requested", "todo", "follow_up", "Send the details the vendor asked for"),
        "Zoom": (
            "vendor_agreed",
            "waiting",
            "wait",
            "Vendor agreed; waiting for the credit to post",
        ),
        "Datadog": (
            "vendor_agreed",
            "waiting",
            "wait",
            "Vendor agreed; waiting for the credit to post",
        ),
    }
    assert all(
        f["recovered_minor"] is None and f["recovered_at"] is None for f in findings.values()
    )
    assert [e["kind"] for e in notion["timeline"]] == [
        "charge",
        "charge",
        "detected",
        "drafted",
        "sent",
        "reply",
        "deadline",
    ]
    reply = next(e for e in notion["timeline"] if e["kind"] == "reply")
    assert reply["title"] == "Vendor asked for more details"
    assert notion["drafts"][0]["channel"] == "vendor_email"
    assert datadog["drafts"][0]["channel"] == "card_dispute"
    assert [t["action"] for t in datadog["trace"]] == [
        "finding.created",
        "draft.created",
        "message.sent",
        "vendor.replied",
    ]


def test_history_tops_up_a_database_that_has_only_the_recovered_claims(
    session_factory: sessionmaker[Session],
    settings: Settings,
    services: Services,
    sources: Sources,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    load_and_run(session_factory, settings, services, sources)
    with monkeypatch.context() as patch:
        patch.setattr(history, "in_flight_claims", list)
        earlier = _replay(session_factory, settings, services, sources)
    before = _snapshot(session_factory)

    added = _replay(session_factory, settings, services, sources)
    after = _snapshot(session_factory)

    assert earlier is not None and (earlier.claims, earlier.recovered) == (8, 8)
    assert added is not None and (added.claims, added.recovered, added.in_flight) == (5, 0, 4)
    assert {key: after[key] for key in before} == before
    assert sorted(after) == list(range(1, len(before) + 6))
    assert _replay(session_factory, settings, services, sources) is None


def test_advancing_the_clock_pays_each_in_flight_claim_once(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    _replay(session_factory, settings, services, sources)
    started = datetime(2026, 10, 2, tzinfo=UTC)

    with session_scope(session_factory) as session:
        first = advance(session, settings, services, sources, days=14)
    with session_scope(session_factory) as session:
        second = advance(session, settings, services, sources, days=14)

    # GitHub and Zendesk answer and pay; Zoom and Datadog had agreed and pay; Notion waits on us.
    assert (first.replies, first.credits, first.run.recovered) == (2, 4, 4)
    assert (second.replies, second.credits, second.run.recovered) == (0, 0, 0)
    with session_scope(session_factory) as session:
        # Ids 29 to 33; a Marriott promise that falls due on the new clock opens after them.
        in_flight = select(FindingRow).where(FindingRow.id.between(29, 33))
        rows = {row.merchant: row for row in session.scalars(in_flight)}
        assert {name: row.status for name, row in rows.items()} == {
            "GitHub": Status.RECOVERED,
            "Zendesk": Status.RECOVERED,
            "Zoom": Status.RECOVERED,
            "Datadog": Status.RECOVERED,
            "Notion": Status.INFO_REQUESTED,
        }
        paid = [row for row in rows.values() if row.status == Status.RECOVERED]
        assert sum(row.recovered_minor or 0 for row in paid) == IN_FLIGHT_MINOR
        # Nothing the simulator did is dated before the clock it advanced from.
        assert all(row.recovered_at is not None and row.recovered_at >= started for row in paid)
        simulated = session.scalars(
            select(TransactionRow).where(TransactionRow.external_id.like("demo_credit_%"))
        ).all()
        assert len(simulated) == 4
        replies = session.scalars(
            select(EmailRow).where(
                EmailRow.message_id.like("<reply-%"), EmailRow.sent_at >= started
            )
        ).all()
        assert len(replies) == 2
        recovered = session.scalars(
            select(FindingRow).where(FindingRow.status == Status.RECOVERED)
        ).all()
        assert sum(r.recovered_minor or 0 for r in recovered) == RECOVERED_MINOR + IN_FLIGHT_MINOR
        credit_ids = [r.recovered_txn_id for r in recovered]
        assert len(credit_ids) == len(set(credit_ids)) == 12
