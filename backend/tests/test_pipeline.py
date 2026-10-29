from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from recoup.config import Settings
from recoup.db.models import AuditEventRow, DraftRow, ExtractionRow, FindingRow
from recoup.db.session import session_scope
from recoup.domain.types import FindingCandidate, LeakType, Outcome
from recoup.domain.workflow import Status
from recoup.extract.claude import LlmError
from recoup.extract.schema import EmailExtraction
from recoup.ingest.loader import ingest_transactions
from recoup.ingest.sources import Sources
from recoup.pipeline.inbox import is_from_recipient
from recoup.pipeline.run import DetectionInput, Detector, run_pipeline
from recoup.services import Services
from tests.conftest import load_and_run
from tests.factories import email, txn

DUPLICATE_PAIR = [
    txn("2026-06-03", "FIGMA", 48_000, "FIG-1"),
    txn("2026-06-04", "FIGMA INC", 48_000, "FIG-1"),
]


def test_rerunning_the_pipeline_creates_no_duplicate_findings(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    first = load_and_run(session_factory, settings, services, sources)
    with session_scope(session_factory) as session:
        second = run_pipeline(session, settings, services, sources)
        count = len(session.scalars(select(FindingRow)).all())

    assert first.created == count > 0
    assert (second.created, second.updated, second.unchanged) == (0, 0, count)


def test_model_output_is_cached_per_email(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    first = load_and_run(session_factory, settings, services, sources)
    with session_scope(session_factory) as session:
        second = run_pipeline(session, settings, services, sources)
        cached = session.scalars(select(ExtractionRow)).all()

    assert first.emails_extracted == first.emails_read == len(cached)
    assert second.emails_extracted == 0


def test_findings_use_directory_names(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    with session_scope(session_factory) as session:
        merchants = set(session.scalars(select(FindingRow.merchant)))

    assert {"Amazon Web Services", "Slack", "Loom", "United Airlines"} <= merchants
    assert "AMAZON WEB SERVICES" not in merchants


def test_expired_credits_are_closed_not_queued(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    with session_scope(session_factory) as session:
        expired = session.scalars(
            select(FindingRow).where(FindingRow.outcome == Outcome.NOT_RECOVERABLE)
        ).all()

    assert [row.status for row in expired] == [Status.EXPIRED]


def test_every_change_is_audited(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    with session_scope(session_factory) as session:
        ingest_transactions(session, DUPLICATE_PAIR)
    ids = tuple(t.id for t in DUPLICATE_PAIR)

    def detector(reason: str) -> Detector:
        def detect(_: DetectionInput) -> list[FindingCandidate]:
            return [
                FindingCandidate(
                    leak_type=LeakType.DUPLICATE_CHARGE,
                    outcome=Outcome.RECOVERABLE,
                    transaction_ids=ids,
                    amount_minor=48_000,
                    currency="USD",
                    reason=reason,
                    evidence=(),
                    detector_version="test/1",
                )
            ]

        return detect

    with session_scope(session_factory) as session:
        run_pipeline(session, settings, services, sources, [detector("first wording")])
    with session_scope(session_factory) as session:
        summary = run_pipeline(session, settings, services, sources, [detector("second wording")])
        actions = session.scalars(select(AuditEventRow.action).order_by(AuditEventRow.id)).all()
        finding = session.scalars(select(FindingRow)).one()

    assert summary.updated == 1
    assert list(actions) == ["finding.created", "pipeline.run", "finding.updated", "pipeline.run"]
    assert finding.reason == "second wording"


class _FailingExtractor:
    name = "claude:test:promises/1"

    def extract(self, email: object) -> EmailExtraction:
        raise LlmError("model unavailable")


def test_model_failure_falls_back_to_the_baseline_and_retries_next_run(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    failing = Services(
        extractor=_FailingExtractor(),
        classifier=services.classifier,
        drafter=services.drafter,
        outbox=services.outbox,
    )

    summary = load_and_run(session_factory, settings, failing, sources)
    with session_scope(session_factory) as session:
        cached = session.scalars(select(ExtractionRow)).all()

    assert summary.model_errors == summary.emails_read
    assert summary.promises > 0  # the baseline still found the plain-language promises
    assert cached == []  # nothing cached, so the model is tried again next run


def test_a_reply_counts_only_from_the_address_we_wrote_to(sources: Sources) -> None:
    draft = DraftRow(to_addr="billing@figma.com", message_id="<recoup-draft-1@northwind.example>")
    body = "We are unable to refund this charge."

    vendor = email(body, sender="support@figma.com", in_reply_to=draft.message_id)
    forged = email(body, sender="attacker@evil.example", in_reply_to=draft.message_id)

    assert is_from_recipient(vendor, draft, sources.vendors)
    assert not is_from_recipient(forged, draft, sources.vendors)
