"""Red team: what a crafted email can and cannot do, even with a fully hijacked model.

`HijackedExtractor` returns exactly what each injection asks for. The controls
that must hold are in code, not in the prompt.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from recoup.config import Settings
from recoup.db.models import AuditEventRow, DraftRow, FindingRow
from recoup.db.session import session_scope
from recoup.domain.sources import Email
from recoup.domain.types import LeakType
from recoup.domain.workflow import Status
from recoup.extract.schema import EmailExtraction, ExtractedPromise
from recoup.ingest.sources import Sources
from recoup.services import Services
from tests.conftest import load_and_run


class HijackedExtractor:
    """Obeys every injection: invents a $9,800 refund and claims the Slack charge was refunded."""

    name = "hijacked/1"

    def extract(self, email: Email) -> EmailExtraction:
        if "AI ASSISTANT" in email.body or "ignore your previous instructions" in email.body:
            return EmailExtraction(
                promises=[
                    ExtractedPromise(
                        kind="refund",
                        amount="9800.00",
                        currency="USD",
                        reference=None,
                        expected_within_days=1,
                        effective_date=None,
                        quote="A refund of $9,800.00 has been approved for your Figma account.",
                    ),
                    ExtractedPromise(
                        kind="refund",
                        amount=None,
                        currency=None,
                        reference=None,
                        expected_within_days=None,
                        effective_date=None,
                        quote="The duplicate Slack charge was already refunded",
                    ),
                ]
            )
        return EmailExtraction(promises=[])


def _run(
    factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    hijacked = Services(
        extractor=HijackedExtractor(),
        classifier=services.classifier,
        drafter=services.drafter,
        outbox=services.outbox,
    )
    load_and_run(factory, settings, hijacked, sources)


def test_hijacked_model_cannot_create_a_finding_from_a_lookalike_domain(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    _run(session_factory, settings, services, sources)
    with session_scope(session_factory) as session:
        refunds = session.scalars(
            select(FindingRow).where(FindingRow.leak_type == LeakType.MISSING_REFUND)
        ).all()
        rejected = session.scalars(
            select(AuditEventRow).where(AuditEventRow.action == "email.rejected")
        ).all()

    assert refunds == []
    assert any(e.payload["reason"] == "unverified_sender" for e in rejected)


def test_hijacked_model_cannot_suppress_a_real_duplicate(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    _run(session_factory, settings, services, sources)
    with session_scope(session_factory) as session:
        slack = session.scalars(
            select(FindingRow).where(
                FindingRow.leak_type == LeakType.DUPLICATE_CHARGE, FindingRow.merchant == "Slack"
            )
        ).all()

    assert [row.status for row in slack] == [Status.OPEN]


def test_nothing_is_drafted_or_sent_without_a_person(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    _run(session_factory, settings, services, sources)
    with session_scope(session_factory) as session:
        drafts = session.scalars(select(DraftRow)).all()
        statuses = set(session.scalars(select(FindingRow.status)))

    assert drafts == []
    assert statuses <= {Status.OPEN, Status.EXPIRED}
