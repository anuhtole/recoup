"""Build API views from stored rows: next action, deadline, and the case timeline."""

from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, date, datetime, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from recoup.api.schemas import (
    AuditEventOut,
    DraftOut,
    EmailOut,
    FindingDetailOut,
    FindingOut,
    NextActionOut,
    TimelineEventOut,
    TransactionOut,
)
from recoup.db.models import AuditEventRow, DraftRow, EmailRow, FindingRow, TransactionRow
from recoup.domain.money import Money
from recoup.domain.sources import Incident
from recoup.domain.types import Evidence, Transaction
from recoup.domain.workflow import CLOSED, STAGE_OF, Status
from recoup.ingest.loader import row_to_transaction
from recoup.ingest.sources import Sources
from recoup.recovery.workflow import finding_transactions, next_action


def _drafts_by_finding(session: Session, ids: Sequence[int]) -> dict[int, list[DraftRow]]:
    grouped: dict[int, list[DraftRow]] = defaultdict(list)
    for draft in session.scalars(
        select(DraftRow).where(DraftRow.finding_id.in_(ids)).order_by(DraftRow.id)
    ):
        grouped[draft.finding_id].append(draft)
    return grouped


def _finding_out(row: FindingRow, drafts: Sequence[DraftRow], as_of: date) -> FindingOut:
    status = Status(row.status)
    open_draft = next((d for d in drafts if d.status == "draft"), None)
    sent = [d for d in drafts if d.status == "sent"]
    action = next_action(row, open_draft, sent[-1] if sent else None, as_of)
    is_closed = status in CLOSED
    days_left = None if row.recover_by is None or is_closed else (row.recover_by - as_of).days
    return FindingOut(
        id=row.id,
        leak_type=row.leak_type,
        outcome=row.outcome,
        status=status,
        stage=STAGE_OF[status],
        merchant=row.merchant,
        amount_minor=row.amount_minor,
        currency=row.currency,
        reason=row.reason,
        recover_by=row.recover_by,
        days_left=days_left,
        recovered_minor=row.recovered_minor,
        detector_version=row.detector_version,
        transaction_ids=row.transaction_ids,
        source_refs=row.source_refs,
        next_action=NextActionOut(kind=action.kind, label=action.label),
        created_at=row.created_at,
    )


def finding_list(session: Session, rows: Sequence[FindingRow], as_of: date) -> list[FindingOut]:
    drafts = _drafts_by_finding(session, [r.id for r in rows])
    return [_finding_out(row, drafts.get(row.id, []), as_of) for row in rows]


def _at(day: str | None, fallback: datetime) -> datetime:
    if not day:
        return fallback
    return datetime.combine(date.fromisoformat(day), time(12), tzinfo=UTC)


def _money(amount_minor: int, currency: str) -> str:
    return Money(amount_minor, currency).format()


def _timeline(
    row: FindingRow,
    txns: Sequence[Transaction],
    emails: Sequence[EmailRow],
    incidents: Sequence[Incident],
    drafts: Sequence[DraftRow],
    trace: Sequence[AuditEventRow],
    as_of: date,
) -> list[TimelineEventOut]:
    events: list[TimelineEventOut] = []
    for txn in txns:
        verb = "Credited" if txn.amount_minor < 0 else "Charged"
        title = f"{verb} {_money(abs(txn.amount_minor), txn.currency)} by {txn.merchant}"
        events.append(
            TimelineEventOut(at=txn.posted_at, kind="charge", title=title, detail=txn.reference)
        )
    by_message = {d.message_id: d for d in drafts if d.message_id}
    for email in emails:
        if email.in_reply_to in by_message:
            continue  # shown as the vendor's reply below
        events.append(
            TimelineEventOut(
                at=email.sent_at,
                kind="promise",
                title=f"Email from {email.from_addr}",
                detail=email.subject,
            )
        )
    for incident in incidents:
        events.append(
            TimelineEventOut(
                at=incident.started_at,
                kind="incident",
                title=f"Outage: {incident.title}",
                detail=incident.status_url,
            )
        )
    for event in trace:
        payload = event.payload
        when = _at(payload.get("clock"), event.occurred_at)
        if event.action == "finding.created":
            events.append(
                TimelineEventOut(
                    at=when, kind="detected", title="Recoup flagged it", detail=row.detector_version
                )
            )
        elif event.action == "draft.created":
            channel = "card dispute" if payload.get("channel") == "card_dispute" else "vendor"
            events.append(
                TimelineEventOut(at=when, kind="drafted", title=f"Drafted a {channel} request")
            )
        elif event.action == "message.sent":
            draft = next((d for d in drafts if d.id == payload.get("draft_id")), None)
            sent_at = draft.sent_at if draft and draft.sent_at else event.occurred_at
            events.append(
                TimelineEventOut(
                    at=sent_at,
                    kind="sent",
                    title=f"Sent to {payload.get('to')}",
                    detail=f"Approved by {event.actor}",
                )
            )
        elif event.action == "vendor.replied":
            reply = next((e for e in emails if e.id == payload.get("email_id")), None)
            decision = str(payload.get("decision", "other")).replace("_", " ")
            events.append(
                TimelineEventOut(
                    at=reply.sent_at if reply else event.occurred_at,
                    kind="reply",
                    title=f"Vendor replied: {decision}",
                    detail=payload.get("quote"),
                )
            )
        elif event.action == "recovery.confirmed":
            amount = _money(int(payload.get("amount_minor", 0)), row.currency)
            events.append(
                TimelineEventOut(
                    at=row.recovered_at or event.occurred_at,
                    kind="recovered",
                    title=f"{amount} credit posted",
                    detail=payload.get("detail"),
                )
            )
        elif event.action == "case.dismissed":
            events.append(
                TimelineEventOut(
                    at=when, kind="dismissed", title="Dismissed", detail=payload.get("reason")
                )
            )
    if row.recover_by and row.status not in CLOSED:
        events.append(
            TimelineEventOut(
                at=datetime.combine(row.recover_by, time(23, 59), tzinfo=UTC),
                kind="deadline",
                title="Claim deadline",
                is_future=row.recover_by >= as_of,
            )
        )
    return sorted(events, key=lambda e: e.at)


def finding_detail(
    session: Session, row: FindingRow, sources: Sources, as_of: date
) -> FindingDetailOut:
    drafts = _drafts_by_finding(session, [row.id]).get(row.id, [])
    txns = finding_transactions(session, row)
    # The credit that closed the case belongs with its evidence too.
    credit = session.get(TransactionRow, row.recovered_txn_id) if row.recovered_txn_id else None
    if credit is not None:
        txns = [*txns, row_to_transaction(credit)]
    message_ids = [d.message_id for d in drafts if d.message_id]
    emails = session.scalars(
        select(EmailRow)
        .where(EmailRow.id.in_(row.source_refs) | EmailRow.in_reply_to.in_(message_ids))
        .order_by(EmailRow.sent_at)
    ).all()
    incidents = [i for i in sources.incidents if i.id in set(row.source_refs)]
    trace = session.scalars(
        select(AuditEventRow)
        .where(AuditEventRow.finding_id == row.id)
        .order_by(AuditEventRow.occurred_at, AuditEventRow.id)
    ).all()
    base = _finding_out(row, drafts, as_of)
    return FindingDetailOut(
        **base.model_dump(),
        evidence=[Evidence.model_validate(e) for e in row.evidence],
        transactions=[TransactionOut.model_validate(t.model_dump()) for t in txns],
        emails=[EmailOut.model_validate(e, from_attributes=True) for e in emails],
        drafts=[DraftOut.model_validate(d, from_attributes=True) for d in drafts],
        timeline=_timeline(row, txns, emails, incidents, drafts, trace, as_of),
        trace=[AuditEventOut.model_validate(e, from_attributes=True) for e in trace],
    )
