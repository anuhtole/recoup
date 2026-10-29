"""A simulated vendor inbox, so the whole loop can be shown on synthetic data.

`advance` moves the detection clock forward and plays the vendors' side: replies
to every request we sent, and posts the credits vendors agree to. Everything after
that goes through the real pipeline: replies are classified by the same
extractor, and cases close only when the ledger shows the money.

Scripted behavior, so a demo always tells the same story:
- card dispute packets: the issuer grants a provisional credit
- Needs-review cases, and Amazon: the vendor first asks for a receipt
- Marriott: declines once, which shows escalation to a card dispute
- everyone else: agrees, and the credit posts a few days later
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from recoup.config import Settings
from recoup.db.models import DraftRow, EmailRow, FindingRow
from recoup.db.state import get_as_of, set_as_of
from recoup.domain.merchants import normalize_merchant
from recoup.domain.money import Money
from recoup.domain.sources import Email, email_key
from recoup.domain.types import Outcome, Transaction, transaction_key
from recoup.domain.workflow import Status
from recoup.ingest.loader import ingest_transactions
from recoup.ingest.sources import Sources, ingest_emails
from recoup.pipeline.run import RunSummary, run_pipeline
from recoup.recovery.workflow import finding_transactions, latest_sent_draft
from recoup.services import Services
from recoup.synth.builder import SOURCE
from recoup.synth.inbox import COMPANY_INBOX

Behavior = Literal["agreed", "declined", "needs_info"]
REPLY_AFTER = timedelta(days=2)
CREDIT_AFTER = timedelta(days=6)
_DECLINES_ONCE = {normalize_merchant("MARRIOTT SF UNION SQ")}
_ASKS_FOR_INFO_ONCE = {normalize_merchant("AMZN Mktp US")}


@dataclass(frozen=True, slots=True)
class AdvanceSummary:
    previous_as_of: str
    as_of: str
    replies: int
    credits: int
    run: RunSummary


def _earlier_replies(session: Session, finding_id: int, exclude: str) -> int:
    message_ids = session.scalars(
        select(DraftRow.message_id).where(
            DraftRow.finding_id == finding_id, DraftRow.message_id.is_not(None)
        )
    ).all()
    return len(
        session.scalars(
            select(EmailRow.id).where(
                EmailRow.in_reply_to.in_([m for m in message_ids if m and m != exclude])
            )
        ).all()
    )


def _behavior(session: Session, row: FindingRow, draft: DraftRow, merchant_key: str) -> Behavior:
    if draft.channel == "card_dispute":
        return "agreed"
    first_contact = _earlier_replies(session, row.id, draft.message_id or "") == 0
    if not first_contact:
        return "agreed"
    if row.outcome == Outcome.NEEDS_REVIEW or merchant_key in _ASKS_FOR_INFO_ONCE:
        return "needs_info"
    if merchant_key in _DECLINES_ONCE:
        return "declined"
    return "agreed"


def _reply_body(behavior: Behavior, amount: str, is_issuer: bool) -> str:
    if behavior == "needs_info":
        return (
            "Hello,\n\nThanks for your message. Could you please send a copy of the receipt or "
            "order confirmation for the second charge? We need it to locate the transaction."
            "\n\nBest regards,\nCustomer Support"
        )
    if behavior == "declined":
        return (
            "Hello,\n\nWe looked into this. Unfortunately, we're unable to refund this charge "
            "because it falls outside our adjustment policy.\n\nBest regards,\nGuest Services"
        )
    if is_issuer:
        return (
            f"Hello,\n\nWe've issued a provisional credit of {amount} to your account while we "
            "investigate the dispute with the merchant.\n\nCard Disputes Team"
        )
    return (
        f"Hello,\n\nThanks for flagging this. We've issued a refund of {amount}. It should "
        "appear on your statement within 5 business days.\n\nBest regards,\nBilling Support"
    )


def _reply(draft: DraftRow, sender: str, body: str, sent_at: datetime) -> Email:
    domain = sender.rsplit("@", 1)[1]
    message_id = f"<reply-{draft.id}@{domain}>"
    return Email(
        id=email_key(message_id),
        message_id=message_id,
        thread_id=draft.message_id or message_id,
        in_reply_to=draft.message_id,
        from_addr=sender,
        to_addr=COMPANY_INBOX,
        subject=f"Re: {draft.subject}",
        sent_at=sent_at,
        body=body,
    )


def _credit(
    row: FindingRow, draft: DraftRow, original: Transaction, posted_at: datetime
) -> Transaction:
    external_id = f"demo_credit_{row.id}_{draft.id}"
    return Transaction(
        id=transaction_key(SOURCE, external_id),
        source=SOURCE,
        external_id=external_id,
        posted_at=posted_at,
        merchant=original.merchant,
        amount_minor=-row.amount_minor,
        currency=row.currency,
        reference=original.reference,
        card_last4=original.card_last4,
    )


def advance(
    session: Session, settings: Settings, services: Services, sources: Sources, days: int = 14
) -> AdvanceSummary:
    if not settings.demo_mode:
        raise PermissionError("The vendor simulator only runs with RECOUP_DEMO_MODE=true")
    previous: date = get_as_of(session, settings)
    as_of = previous + timedelta(days=days)
    horizon = datetime.combine(as_of, time.max, tzinfo=UTC)

    emails: list[Email] = []
    credits: list[Transaction] = []
    for row in session.scalars(
        select(FindingRow).where(FindingRow.status.in_([Status.SENT, Status.VENDOR_AGREED]))
    ).all():
        draft = latest_sent_draft(session, row.id)
        txns = finding_transactions(session, row)
        if draft is None or draft.sent_at is None or not txns:
            continue
        credit_at = draft.sent_at + CREDIT_AFTER
        if row.status == Status.VENDOR_AGREED:
            # Agreed on an earlier advance; the credit lands once its date arrives.
            if credit_at <= horizon:
                credits.append(_credit(row, draft, txns[0], credit_at))
            continue
        if session.scalar(select(EmailRow.id).where(EmailRow.in_reply_to == draft.message_id)):
            continue
        reply_at = draft.sent_at + REPLY_AFTER
        if reply_at > horizon:
            continue

        merchant_key = normalize_merchant(txns[0].merchant)
        behavior = _behavior(session, row, draft, merchant_key)
        is_issuer = draft.channel == "card_dispute"
        vendor = sources.vendors.for_merchant(merchant_key)
        sender = draft.to_addr if is_issuer or vendor is None else vendor.support_email
        amount = Money(row.amount_minor, row.currency).format()
        emails.append(_reply(draft, sender, _reply_body(behavior, amount, is_issuer), reply_at))
        if behavior == "agreed" and credit_at <= horizon:
            credits.append(_credit(row, draft, txns[0], credit_at))

    ingest_emails(session, emails)
    ingest_transactions(session, credits)
    set_as_of(session, as_of)
    session.flush()
    run = run_pipeline(session, settings, services, sources)
    return AdvanceSummary(previous.isoformat(), as_of.isoformat(), len(emails), len(credits), run)
