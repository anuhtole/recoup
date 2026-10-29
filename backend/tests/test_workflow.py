from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from recoup.config import Settings
from recoup.db.models import DraftRow, FindingRow
from recoup.db.session import session_scope
from recoup.domain.types import LeakType
from recoup.domain.workflow import Status
from recoup.extract.schema import ReplyAssessment
from recoup.ingest.loader import ingest_transactions
from recoup.ingest.sources import Sources
from recoup.recovery.drafting import TemplateDrafter
from recoup.recovery.outbox import LocalOutbox
from recoup.recovery.workflow import (
    TransitionError,
    apply_reply,
    create_draft,
    dismiss,
    match_recoveries,
    next_action,
    send_draft,
)
from recoup.services import Services
from tests.conftest import load_and_run
from tests.factories import email, txn

AS_OF = date(2026, 10, 1)


@pytest.fixture
def loaded(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> sessionmaker[Session]:
    load_and_run(session_factory, settings, services, sources)
    return session_factory


def _case(session: Session, leak_type: LeakType, merchant: str) -> FindingRow:
    return session.scalars(
        select(FindingRow).where(FindingRow.leak_type == leak_type, FindingRow.merchant == merchant)
    ).one()


def _draft(session: Session, row: FindingRow, sources: Sources) -> DraftRow:
    return create_draft(
        session,
        row,
        vendors=sources.vendors,
        drafter=TemplateDrafter(),
        as_of=AS_OF,
        card_dispute_address="disputes@card-issuer.example",
        actor="user:test",
    )


def test_recipient_comes_from_the_vendor_directory(
    loaded: sessionmaker[Session], sources: Sources
) -> None:
    with session_scope(loaded) as session:
        row = _case(session, LeakType.DUPLICATE_CHARGE, "Figma")
        draft = _draft(session, row, sources)

        assert (draft.channel, draft.to_addr) == ("vendor_email", "billing@figma.com")
        assert "$480.00" in draft.body and row.status == Status.DRAFTED


def test_unknown_merchant_becomes_a_card_dispute(
    loaded: sessionmaker[Session], sources: Sources
) -> None:
    with session_scope(loaded) as session:
        row = _case(session, LeakType.DUPLICATE_CHARGE, "Zuni Cafe")
        draft = _draft(session, row, sources)

        assert (draft.channel, draft.to_addr) == ("card_dispute", "disputes@card-issuer.example")


def test_redrafting_replaces_the_open_draft(
    loaded: sessionmaker[Session], sources: Sources
) -> None:
    with session_scope(loaded) as session:
        row = _case(session, LeakType.DUPLICATE_CHARGE, "Figma")
        first, second = _draft(session, row, sources), _draft(session, row, sources)

        assert first.id == second.id


def test_send_requires_an_unsent_draft_and_marks_the_case_sent(
    loaded: sessionmaker[Session], sources: Sources
) -> None:
    with session_scope(loaded) as session:
        row = _case(session, LeakType.DUPLICATE_CHARGE, "Figma")
        draft = _draft(session, row, sources)
        send_draft(session, draft, outbox=LocalOutbox(), as_of=AS_OF, actor="user:test")

        assert (row.status, draft.status) == (Status.SENT, "sent")
        assert draft.message_id and draft.sent_at and draft.sent_at.date() == AS_OF
        with pytest.raises(TransitionError):
            send_draft(session, draft, outbox=LocalOutbox(), as_of=AS_OF, actor="user:test")
        with pytest.raises(TransitionError):
            _draft(session, row, sources)


def test_expired_credit_cannot_be_drafted(loaded: sessionmaker[Session], sources: Sources) -> None:
    with session_scope(loaded) as session:
        row = _case(session, LeakType.SLA_CREDIT, "Zoom")

        with pytest.raises(TransitionError):
            _draft(session, row, sources)


def test_reply_changes_status_only_when_its_quote_is_grounded(
    loaded: sessionmaker[Session], sources: Sources
) -> None:
    with session_scope(loaded) as session:
        row = _case(session, LeakType.DUPLICATE_CHARGE, "Figma")
        draft = _draft(session, row, sources)
        send_draft(session, draft, outbox=LocalOutbox(), as_of=AS_OF, actor="user:test")
        reply = email("We've issued a refund of $480.00.", in_reply_to=draft.message_id)

        invented = ReplyAssessment(decision="agreed", amount=None, quote="Refund sent!", summary="")
        apply_reply(session, row, reply, invented, "test")
        assert row.status == Status.SENT

        grounded = invented.model_copy(update={"quote": "We've issued a refund of $480.00."})
        apply_reply(session, row, reply, grounded, "test")
        assert row.status == Status.VENDOR_AGREED


def test_only_a_ledger_credit_closes_a_case_and_each_credit_closes_one(
    loaded: sessionmaker[Session], sources: Sources
) -> None:
    with session_scope(loaded) as session:
        row = _case(session, LeakType.DUPLICATE_CHARGE, "Figma")
        draft = _draft(session, row, sources)
        send_draft(session, draft, outbox=LocalOutbox(), as_of=AS_OF, actor="user:test")
        credit = txn("2026-10-05", "FIGMA", -48_000, "FIG-202606")
        ingest_transactions(session, [credit])

        assert match_recoveries(session, [], sources.vendors) == 0
        assert match_recoveries(session, [credit], sources.vendors) == 1
        assert (row.status, row.recovered_minor, row.recovered_txn_id) == (
            Status.RECOVERED,
            48_000,
            credit.id,
        )
        assert match_recoveries(session, [credit], sources.vendors) == 0


def test_dismiss_needs_a_reason(loaded: sessionmaker[Session]) -> None:
    with session_scope(loaded) as session:
        row = _case(session, LeakType.DUPLICATE_CHARGE, "Figma")
        with pytest.raises(TransitionError):
            dismiss(session, row, "  ", "user:test", AS_OF)
        dismiss(session, row, "Vendor already refunded by phone", "user:test", AS_OF)

        assert row.status == Status.DISMISSED


def test_next_action_follows_the_case(loaded: sessionmaker[Session], sources: Sources) -> None:
    with session_scope(loaded) as session:
        row = _case(session, LeakType.DUPLICATE_CHARGE, "Figma")
        assert next_action(row, None, None, AS_OF).kind == "draft"
        draft = _draft(session, row, sources)
        assert next_action(row, draft, None, AS_OF).kind == "review"
        send_draft(session, draft, outbox=LocalOutbox(), as_of=AS_OF, actor="user:test")
        assert next_action(row, None, draft, AS_OF).kind == "wait"
        assert next_action(row, None, draft, date(2026, 10, 12)).kind == "follow_up"
        row.status = Status.VENDOR_DECLINED
        assert next_action(row, None, draft, AS_OF).kind == "escalate"
