"""The recovery state machine. Every transition is checked here and audited.

Text never moves money: a vendor reply can change status, but a case is only
`recovered` when a matching credit appears in the ledger.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from recoup.db.models import AuditEventRow, DraftRow, FindingRow, TransactionRow
from recoup.detectors.vendor_keys import vendor_key
from recoup.domain.sources import Email, Vendor
from recoup.domain.types import Evidence, LeakType, Outcome, Transaction
from recoup.domain.vendors import VendorDirectory
from recoup.domain.workflow import AWAITING_MONEY, CLOSED, DRAFTABLE, Status
from recoup.extract.schema import ReplyAssessment
from recoup.ingest.loader import row_to_transaction
from recoup.recovery.drafting import Drafter
from recoup.recovery.facts import CaseFacts
from recoup.recovery.outbox import Outbox

Channel = Literal["vendor_email", "card_dispute"]
SYSTEM_ACTOR = "system:recovery"


class TransitionError(ValueError):
    """The requested action is not allowed from the case's current state."""


def clock_time(as_of: date) -> datetime:
    """A timestamp on the detection clock, so demo time and real time never interleave."""
    return datetime.combine(as_of, datetime.now(UTC).time().replace(microsecond=0), tzinfo=UTC)


def audit(
    session: Session, actor: str, action: str, finding_id: int | None, **payload: Any
) -> None:
    session.add(AuditEventRow(actor=actor, action=action, finding_id=finding_id, payload=payload))


def finding_transactions(session: Session, row: FindingRow) -> list[Transaction]:
    rows = session.scalars(
        select(TransactionRow)
        .where(TransactionRow.id.in_(row.transaction_ids))
        .order_by(TransactionRow.posted_at)
    )
    return [row_to_transaction(r) for r in rows]


def open_draft(session: Session, finding_id: int) -> DraftRow | None:
    return session.scalar(
        select(DraftRow).where(DraftRow.finding_id == finding_id, DraftRow.status == "draft")
    )


def latest_sent_draft(session: Session, finding_id: int) -> DraftRow | None:
    return session.scalar(
        select(DraftRow)
        .where(DraftRow.finding_id == finding_id, DraftRow.status == "sent")
        .order_by(DraftRow.sent_at.desc(), DraftRow.id.desc())
    )


def _vendor_for(txns: Sequence[Transaction], vendors: VendorDirectory) -> Vendor | None:
    for txn in txns:
        vendor = vendors.for_merchant(vendor_key(txn, vendors))
        if vendor is not None:
            return vendor
    return None


def case_facts(
    session: Session, row: FindingRow, vendors: VendorDirectory, as_of: date
) -> CaseFacts:
    txns = finding_transactions(session, row)
    return CaseFacts(
        finding_id=row.id,
        leak_type=LeakType(row.leak_type),
        merchant=row.merchant,
        vendor=_vendor_for(txns, vendors),
        amount_minor=row.amount_minor,
        currency=row.currency,
        reason=row.reason,
        transactions=tuple(txns),
        evidence=tuple(Evidence.model_validate(e) for e in row.evidence),
        as_of=as_of,
        is_escalation=row.status == Status.VENDOR_DECLINED,
    )


def channel_for(facts: CaseFacts, card_dispute_address: str) -> tuple[Channel, str]:
    if facts.vendor is None or facts.is_escalation:
        return "card_dispute", card_dispute_address
    return "vendor_email", facts.vendor.support_email


def create_draft(
    session: Session,
    row: FindingRow,
    *,
    vendors: VendorDirectory,
    drafter: Drafter,
    as_of: date,
    card_dispute_address: str,
    actor: str,
) -> DraftRow:
    status = Status(row.status)
    if status not in DRAFTABLE:
        raise TransitionError(f"Cannot draft a request while the case is {status.value}")
    if row.outcome == Outcome.NOT_RECOVERABLE:
        raise TransitionError("This credit can no longer be claimed")

    facts = case_facts(session, row, vendors, as_of)
    channel, to_addr = channel_for(facts, card_dispute_address)
    content = drafter.draft(facts)
    draft = open_draft(session, row.id)
    if draft is None:
        draft = DraftRow(finding_id=row.id, status="draft")
        session.add(draft)
    draft.channel, draft.to_addr = channel, to_addr
    draft.subject, draft.body, draft.drafter = content.subject, content.body, content.drafter
    if status is Status.OPEN:
        row.status = Status.DRAFTED
    session.flush()
    audit(
        session,
        actor,
        "draft.created",
        row.id,
        draft_id=draft.id,
        channel=channel,
        to=to_addr,
        drafter=content.drafter,
        clock=as_of.isoformat(),
    )
    return draft


def update_draft(
    session: Session, draft: DraftRow, subject: str, body: str, actor: str
) -> DraftRow:
    if draft.status != "draft":
        raise TransitionError("A sent message cannot be edited")
    if not subject.strip() or not body.strip():
        raise TransitionError("Subject and body are required")
    draft.subject, draft.body = subject.strip(), body.strip()
    session.flush()
    audit(session, actor, "draft.edited", draft.finding_id, draft_id=draft.id)
    return draft


def send_draft(
    session: Session, draft: DraftRow, *, outbox: Outbox, as_of: date, actor: str
) -> DraftRow:
    """Called only after a person explicitly approves the message."""
    if draft.status != "draft":
        raise TransitionError("This message was already sent")
    row = session.get(FindingRow, draft.finding_id)
    if row is None:
        raise TransitionError("Case not found")
    draft.message_id = outbox.send(draft)
    draft.status, draft.sent_by, draft.sent_at = "sent", actor, clock_time(as_of)
    row.status = Status.SENT
    session.flush()
    audit(
        session,
        actor,
        "message.sent",
        row.id,
        draft_id=draft.id,
        channel=draft.channel,
        to=draft.to_addr,
        message_id=draft.message_id,
    )
    return draft


def dismiss(session: Session, row: FindingRow, reason: str, actor: str, as_of: date) -> FindingRow:
    if row.status in CLOSED:
        raise TransitionError(f"The case is already {row.status}")
    if not reason.strip():
        raise TransitionError("A reason is required to dismiss a case")
    row.status, row.dismissed_reason = Status.DISMISSED, reason.strip()
    audit(session, actor, "case.dismissed", row.id, reason=reason.strip(), clock=as_of.isoformat())
    return row


_REPLY_STATUS: dict[str, Status] = {
    "agreed": Status.VENDOR_AGREED,
    "declined": Status.VENDOR_DECLINED,
    "needs_info": Status.INFO_REQUESTED,
}


def apply_reply(
    session: Session, row: FindingRow, email: Email, assessment: ReplyAssessment, classifier: str
) -> None:
    grounded = " ".join(assessment.quote.split()) in " ".join(email.body.split())
    decision = assessment.decision if grounded else "other"
    payload = {
        "email_id": email.id,
        "from": email.from_addr,
        "decision": decision,
        "quote": assessment.quote if grounded else None,
        "summary": assessment.summary,
        "classifier": classifier,
    }
    new_status = _REPLY_STATUS.get(decision)
    if new_status is not None and row.status in (Status.SENT, Status.VENDOR_AGREED):
        row.status = new_status
    audit(session, SYSTEM_ACTOR, "vendor.replied", row.id, **payload)


def match_recoveries(
    session: Session, transactions: Sequence[Transaction], vendors: VendorDirectory
) -> int:
    """Close cases whose money has actually arrived. Each credit closes at most one case."""
    used = set(
        session.scalars(
            select(FindingRow.recovered_txn_id).where(FindingRow.recovered_txn_id.is_not(None))
        )
    )
    credits = [t for t in transactions if not t.is_debit and t.id not in used]
    awaiting = session.scalars(
        select(FindingRow).where(FindingRow.status.in_([s.value for s in AWAITING_MONEY]))
    ).all()

    recovered = 0
    for row in awaiting:
        draft = latest_sent_draft(session, row.id)
        if draft is None or draft.sent_at is None:
            continue
        keys = {vendor_key(t, vendors) for t in finding_transactions(session, row)}
        since = draft.sent_at - timedelta(days=1)
        match = next(
            (
                c
                for c in credits
                if vendor_key(c, vendors) in keys
                and c.posted_at >= since
                and -c.amount_minor == row.amount_minor
                and c.currency == row.currency
            ),
            None,
        )
        if match is None:
            continue
        credits.remove(match)
        row.status = Status.RECOVERED
        row.recovered_minor, row.recovered_txn_id = -match.amount_minor, match.id
        row.recovered_at = match.posted_at
        audit(
            session,
            SYSTEM_ACTOR,
            "recovery.confirmed",
            row.id,
            transaction_id=match.id,
            amount_minor=-match.amount_minor,
            detail=f"{match.posted_at.date()} {match.merchant} {match.money.format()}",
        )
        recovered += 1
    return recovered


ActionKind = Literal["draft", "review", "follow_up", "escalate", "wait", "none"]


@dataclass(frozen=True)
class NextAction:
    kind: ActionKind
    label: str


FOLLOW_UP_AFTER_DAYS = 10


def next_action(
    row: FindingRow, draft: DraftRow | None, last_sent: DraftRow | None, as_of: date
) -> NextAction:
    status = Status(row.status)
    if status is Status.EXPIRED:
        return NextAction("none", "Claim window closed")
    if status in CLOSED:
        return NextAction("none", "Closed")
    if draft is not None:
        return NextAction("review", "Review and send the draft")
    if status is Status.OPEN:
        label = (
            "Confirm, then draft a request"
            if row.outcome == Outcome.NEEDS_REVIEW
            else "Draft a recovery request"
        )
        return NextAction("draft", label)
    if status is Status.INFO_REQUESTED:
        return NextAction("follow_up", "Send the details the vendor asked for")
    if status is Status.VENDOR_DECLINED:
        if row.recover_by is not None and as_of > row.recover_by:
            return NextAction("none", "Vendor declined after the dispute window closed")
        return NextAction("escalate", "Escalate to a card dispute")
    if status is Status.VENDOR_AGREED:
        return NextAction("wait", "Vendor agreed; waiting for the credit to post")
    if status is Status.SENT and last_sent is not None and last_sent.sent_at is not None:
        waited = (as_of - last_sent.sent_at.date()).days
        if waited >= FOLLOW_UP_AFTER_DAYS:
            return NextAction("follow_up", f"No reply in {waited} days; follow up")
        return NextAction("wait", "Waiting on the vendor")
    return NextAction("wait", "Waiting on the vendor")
