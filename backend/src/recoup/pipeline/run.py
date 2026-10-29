"""One detection run, as a fixed sequence of steps:

1. read the inbox: extract promises (model or baseline), validate them in code,
   and apply vendor replies to requests we sent
2. run every detector over the ledger plus validated promises and contracts
3. upsert findings idempotently, auditing every change
4. close cases whose money has posted

This is a workflow, not an agent loop. The code fixes the order; the model only
reads text, and its output passes through `extract/validate.py` first.
"""

from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from recoup.config import Settings
from recoup.db.models import AuditEventRow, FindingRow, TransactionRow
from recoup.db.state import get_as_of
from recoup.detectors.duplicates import DuplicateConfig, detect_duplicates
from recoup.detectors.outages import OutageConfig, detect_sla_credits
from recoup.detectors.promises import PromiseConfig, detect_broken_promises
from recoup.domain.merchants import normalize_merchant
from recoup.domain.sources import Promise
from recoup.domain.types import FindingCandidate, Outcome, Transaction
from recoup.domain.workflow import Status
from recoup.extract.validate import PromiseTiming
from recoup.ingest.loader import row_to_transaction
from recoup.ingest.sources import Sources
from recoup.pipeline.inbox import read_inbox
from recoup.recovery.workflow import match_recoveries
from recoup.services import Services

SYSTEM_ACTOR = "system:pipeline"


@dataclass(frozen=True)
class DetectionInput:
    transactions: Sequence[Transaction]
    promises: Sequence[Promise]
    sources: Sources
    as_of: date


Detector = Callable[[DetectionInput], list[FindingCandidate]]


@dataclass(frozen=True, slots=True)
class RunSummary:
    as_of: str
    transactions: int
    emails_read: int
    emails_extracted: int
    promises: int
    rejected: int
    model_errors: int
    replies: int
    created: int
    updated: int
    unchanged: int
    recovered: int


def detectors_from_settings(settings: Settings) -> list[Detector]:
    duplicates = DuplicateConfig(
        window_days=settings.duplicate_window_days,
        min_amount_minor=settings.min_recoverable_minor,
        dispute_window_days=settings.dispute_window_days,
    )
    promises = PromiseConfig(
        min_amount_minor=settings.min_recoverable_minor,
        dispute_window_days=settings.dispute_window_days,
    )
    outages = OutageConfig(min_amount_minor=settings.min_recoverable_minor)
    return [
        lambda d: detect_duplicates(d.transactions, duplicates),
        lambda d: detect_broken_promises(
            d.transactions, d.promises, d.sources.vendors, d.as_of, promises
        ),
        lambda d: detect_sla_credits(
            d.transactions,
            d.sources.contracts,
            d.sources.incidents,
            d.sources.vendors,
            d.as_of,
            outages,
        ),
    ]


def _display_merchant(candidate: FindingCandidate, sources: Sources) -> str:
    vendor = sources.vendors.for_merchant(normalize_merchant(candidate.merchant))
    if vendor is not None:
        return vendor.name
    # Card descriptors arrive upper-case ("ZUNI CAFE"); show them as names.
    return candidate.merchant.title() if candidate.merchant.isupper() else candidate.merchant


def _snapshot(candidate: FindingCandidate, merchant: str) -> dict[str, Any]:
    return {
        "transaction_ids": list(candidate.transaction_ids),
        "source_refs": list(candidate.source_refs),
        "outcome": candidate.outcome.value,
        "merchant": merchant,
        "amount_minor": candidate.amount_minor,
        "currency": candidate.currency,
        "reason": candidate.reason,
        "evidence": [e.model_dump() for e in candidate.evidence],
        "detector_version": candidate.detector_version,
        "recover_by": candidate.recover_by,
    }


def _row_snapshot(row: FindingRow) -> dict[str, Any]:
    return {
        "transaction_ids": list(row.transaction_ids),
        "source_refs": list(row.source_refs),
        "outcome": row.outcome,
        "merchant": row.merchant,
        "amount_minor": row.amount_minor,
        "currency": row.currency,
        "reason": row.reason,
        "evidence": row.evidence,
        "detector_version": row.detector_version,
        "recover_by": row.recover_by,
    }


def _audit_payload(snapshot: dict[str, Any]) -> dict[str, Any]:
    recover_by = snapshot["recover_by"]
    return {**snapshot, "recover_by": recover_by.isoformat() if recover_by else None}


def upsert_finding(
    session: Session, candidate: FindingCandidate, merchant: str, as_of: date
) -> str:
    row = session.scalar(select(FindingRow).where(FindingRow.key == candidate.key))
    snapshot = _snapshot(candidate, merchant)

    if row is None:
        row = FindingRow(key=candidate.key, leak_type=candidate.leak_type.value, **snapshot)
        session.add(row)
        session.flush()
        action = "finding.created"
    elif _row_snapshot(row) != snapshot:
        for name, value in snapshot.items():
            setattr(row, name, value)
        session.flush()
        action = "finding.updated"
    else:
        return "unchanged"

    if row.outcome == Outcome.NOT_RECOVERABLE and row.status in (Status.OPEN, Status.DRAFTED):
        row.status = Status.EXPIRED

    session.add(
        AuditEventRow(
            actor=SYSTEM_ACTOR,
            action=action,
            finding_id=row.id,
            payload={**_audit_payload(snapshot), "clock": as_of.isoformat()},
        )
    )
    return action


def run_pipeline(
    session: Session,
    settings: Settings,
    services: Services,
    sources: Sources,
    detectors: Sequence[Detector] | None = None,
) -> RunSummary:
    as_of = get_as_of(session, settings)
    rows = session.scalars(select(TransactionRow).order_by(TransactionRow.posted_at)).all()
    transactions = [row_to_transaction(row) for row in rows]
    timing = PromiseTiming(settings.promise_default_days, settings.promise_grace_days)

    inbox = read_inbox(session, services.extractor, services.classifier, sources.vendors, timing)
    data = DetectionInput(transactions, inbox.promises, sources, as_of)

    counts = {"finding.created": 0, "finding.updated": 0, "unchanged": 0}
    for detector in detectors if detectors is not None else detectors_from_settings(settings):
        for candidate in detector(data):
            merchant = _display_merchant(candidate, sources)
            counts[upsert_finding(session, candidate, merchant, as_of)] += 1
    recovered = match_recoveries(session, transactions, sources.vendors)

    summary = RunSummary(
        as_of=as_of.isoformat(),
        transactions=len(transactions),
        emails_read=inbox.read,
        emails_extracted=inbox.newly_extracted,
        promises=len(inbox.promises),
        rejected=inbox.rejected,
        model_errors=inbox.errors,
        replies=inbox.replies,
        created=counts["finding.created"],
        updated=counts["finding.updated"],
        unchanged=counts["unchanged"],
        recovered=recovered,
    )
    session.add(
        AuditEventRow(
            actor=SYSTEM_ACTOR,
            action="pipeline.run",
            payload={**asdict(summary), "mode": services.mode},
        )
    )
    return summary
