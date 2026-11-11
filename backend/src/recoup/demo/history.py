"""Claims Northwind made before the demo starts, so day one shows money back and in flight.

Each past claim is replayed through the path a live one takes. The detectors flag it
on the ledger as it stood that day, the workflow drafts and sends the request, the
vendor's reply lands in the inbox, and the case closes only when the pipeline finds
the credit in the ledger. Nothing here sets a status or a recovered amount.

The script adds a few rows to the same card feed as the synthetic ledger: the charge
that leaked and, for claims already won, the credit that came back. A claim still in
flight has no credit yet: it stops at the request, or at the vendor's answer. None of
these rows changes an existing finding.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from recoup.config import Settings
from recoup.db.models import FindingRow, TransactionRow
from recoup.db.state import get_as_of
from recoup.demo.simulator import REPLY_AFTER, Behavior, reply_body, reply_email
from recoup.domain.money import Money
from recoup.domain.sources import Email, Promise, email_key
from recoup.domain.types import LeakType, Transaction, transaction_key
from recoup.domain.workflow import STAGE_OF, Stage, Status
from recoup.extract.validate import PromiseTiming
from recoup.ingest.loader import ingest_transactions, row_to_transaction
from recoup.ingest.sources import Sources, ingest_emails
from recoup.pipeline.inbox import read_inbox
from recoup.pipeline.run import (
    DetectionInput,
    RunSummary,
    detectors_from_settings,
    display_merchant,
    run_pipeline,
    upsert_finding,
)
from recoup.recovery.workflow import create_draft, send_draft
from recoup.services import Services
from recoup.synth.builder import SOURCE
from recoup.synth.inbox import COMPANY_INBOX

logger = logging.getLogger(__name__)

# The person who approved each request. The demo has one reviewer.
APPROVER = "user:reviewer"
_CARD = "4417"


@dataclass(frozen=True)
class PastClaim:
    slug: str
    leak_type: LeakType
    # The transactions the finding names, which may include rows already in the ledger.
    flagged: tuple[str, ...]
    # The charges this claim adds to the ledger. The first one marks the claim as replayed.
    charges: tuple[Transaction, ...]
    found_on: date
    sent_on: date
    emails: tuple[Email, ...] = ()
    # The money coming back. None while the claim is still in flight.
    credit: Transaction | None = None
    # What the vendor answered, and how long after the request. None: no answer yet.
    reply: Behavior | None = "agreed"
    reply_after: timedelta = REPLY_AFTER

    @property
    def ledger(self) -> tuple[Transaction, ...]:
        return self.charges if self.credit is None else (*self.charges, self.credit)

    @property
    def last_event_on(self) -> date:
        if self.credit is not None:
            return self.credit.posted_at.date()
        return self.sent_on if self.reply is None else self.sent_on + self.reply_after


@dataclass(frozen=True, slots=True)
class HistorySummary:
    claims: int
    recovered: int
    recovered_minor: int
    in_flight: int
    in_flight_minor: int
    run: RunSummary


def _txn(
    slug: str,
    part: str,
    day: date,
    at: time,
    merchant: str,
    amount_minor: int,
    reference: str | None,
) -> Transaction:
    external_id = f"history_{slug}_{part}"
    return Transaction(
        id=transaction_key(SOURCE, external_id),
        source=SOURCE,
        external_id=external_id,
        posted_at=datetime.combine(day, at, tzinfo=UTC),
        merchant=merchant,
        amount_minor=amount_minor,
        currency="USD",
        reference=reference,
        card_last4=_CARD,
    )


def _email(slug: str, day: date, sender: str, subject: str, body: str) -> Email:
    message_id = f"<history-{slug}@{sender.rsplit('@', 1)[1]}>"
    return Email(
        id=email_key(message_id),
        message_id=message_id,
        thread_id=message_id,
        from_addr=sender,
        to_addr=COMPANY_INBOX,
        subject=subject,
        sent_at=datetime.combine(day, time(hour=10), tzinfo=UTC),
        body=body,
    )


def _billed_twice(
    slug: str, invoice: Transaction, found_on: date, sent_on: date, credited_on: date
) -> PastClaim:
    """An invoice already in the ledger, charged again the next day and later refunded."""
    again = invoice.posted_at.date() + timedelta(days=1)
    copy = _txn(
        slug, "copy", again, time(9, 42), invoice.merchant, invoice.amount_minor, invoice.reference
    )
    credit = _txn(
        slug,
        "credit",
        credited_on,
        time(14, 5),
        invoice.merchant,
        -invoice.amount_minor,
        invoice.reference,
    )
    return PastClaim(
        slug,
        LeakType.DUPLICATE_CHARGE,
        (invoice.id, copy.id),
        (copy,),
        found_on,
        sent_on,
        credit=credit,
    )


def _refund_promised(
    slug: str,
    merchant: str,
    amount_minor: int,
    reference: str,
    charged_on: date,
    email: Email,
    found_on: date,
    sent_on: date,
    credited_on: date,
) -> PastClaim:
    """A refund the vendor confirmed by email, which only posted after we asked."""
    charge = _txn(slug, "charge", charged_on, time(13, 27), merchant, amount_minor, reference)
    credit = _txn(slug, "credit", credited_on, time(11, 18), merchant, -amount_minor, reference)
    return PastClaim(
        slug,
        LeakType.MISSING_REFUND,
        (charge.id,),
        (charge,),
        found_on,
        sent_on,
        (email,),
        credit=credit,
    )


def _staples() -> PastClaim:
    order, amount = "ORD-604418", Money(131_842, "USD").format()
    email = _email(
        "staples-return",
        date(2026, 6, 17),
        "orders@staples.com",
        f"Your return for order {order}",
        f"Hello,\n\nWe've received the two standing desks you sent back from order {order}. "
        f"A refund of {amount} for order {order} has been issued to your card ending in "
        f"{_CARD} and should appear within 5-7 business days.\n\nThanks,\n"
        "Staples Customer Service",
    )
    return _refund_promised(
        "staples-return",
        "STAPLES",
        131_842,
        order,
        date(2026, 6, 9),
        email,
        found_on=date(2026, 7, 2),
        sent_on=date(2026, 7, 3),
        credited_on=date(2026, 7, 10),
    )


def _wework() -> PastClaim:
    booking, amount = "EVT-30718", Money(127_500, "USD").format()
    email = _email(
        "wework-event-space",
        date(2026, 8, 5),
        "members@wework.com",
        f"Booking {booking} released",
        "Hi Dana,\n\nThanks for letting us know the July 30 offsite moved. We've released "
        f"the 12th floor event space under booking {booking}. A refund of {amount} for "
        f"booking {booking} has been issued to your card ending in {_CARD} and should appear "
        "within 5-7 business days.\n\nThanks,\nWeWork Member Support",
    )
    return _refund_promised(
        "wework-event-space",
        "WEWORK",
        127_500,
        booking,
        date(2026, 7, 21),
        email,
        found_on=date(2026, 8, 20),
        sent_on=date(2026, 8, 21),
        credited_on=date(2026, 8, 28),
    )


def _amazon() -> PastClaim:
    order, amount = "112-5830274", Money(41_287, "USD").format()
    email = _email(
        "amazon-return",
        date(2026, 9, 3),
        "cs-reply@amazon.com",
        f"Your return of order {order} has been received",
        "Hello,\n\nWe've received the item you returned (Jabra Speak2 75 speakerphone, qty 1). "
        f"Your refund of {amount} for order {order} will be issued to your original payment "
        "method. Most refunds are completed within 3-5 business days after we receive the "
        "return.\n\nThanks,\nAmazon.com",
    )
    return _refund_promised(
        "amazon-return",
        "AMZN Mktp US",
        41_287,
        order,
        date(2026, 8, 27),
        email,
        found_on=date(2026, 9, 16),
        sent_on=date(2026, 9, 17),
        credited_on=date(2026, 9, 25),
    )


def _calendly() -> PastClaim:
    """Calendly confirmed the cancellation on Jun 8 (already in the inbox), then billed July."""
    charge = _txn(
        "calendly-july", "charge", date(2026, 7, 5), time(9, 31), "CALENDLY", 9_600, "CAL-202607"
    )
    credit = _txn(
        "calendly-july", "credit", date(2026, 7, 15), time(16, 2), "CALENDLY", -9_600, "CAL-202607"
    )
    return PastClaim(
        "calendly-july",
        LeakType.CHARGED_AFTER_CANCELLATION,
        (charge.id,),
        (charge,),
        found_on=date(2026, 7, 6),
        sent_on=date(2026, 7, 7),
        credit=credit,
    )


def _dell() -> PastClaim:
    """Not in the vendor directory, so this one went to the card issuer as a dispute."""
    merchant, amount, order = "DELL TECHNOLOGIES", 284_617, "DELL-88213964"
    first = _txn("dell-laptops", "charge", date(2026, 9, 8), time(15, 12), merchant, amount, order)
    second = _txn("dell-laptops", "copy", date(2026, 9, 9), time(8, 47), merchant, amount, order)
    credit = _txn(
        "dell-laptops", "credit", date(2026, 9, 18), time(10, 30), merchant, -amount, order
    )
    return PastClaim(
        "dell-laptops",
        LeakType.DUPLICATE_CHARGE,
        (first.id, second.id),
        (first, second),
        found_on=date(2026, 9, 10),
        sent_on=date(2026, 9, 11),
        credit=credit,
    )


def _charged_twice(
    slug: str,
    merchant: str,
    amount_minor: int,
    reference: str,
    charged_on: date,
    found_on: date,
    sent_on: date,
    reply: Behavior | None,
    reply_after: timedelta = REPLY_AFTER,
) -> PastClaim:
    """One invoice charged on two consecutive days. Asked for, not back yet."""
    first = _txn(slug, "charge", charged_on, time(16, 38), merchant, amount_minor, reference)
    second = _txn(
        slug, "copy", charged_on + timedelta(days=1), time(9, 6), merchant, amount_minor, reference
    )
    return PastClaim(
        slug,
        LeakType.DUPLICATE_CHARGE,
        (first.id, second.id),
        (first, second),
        found_on,
        sent_on,
        reply=reply,
        reply_after=reply_after,
    )


def _github() -> PastClaim:
    """Sent 18 days before the demo starts, and GitHub has not answered."""
    invoice, amount = "GHC-204817", Money(91_200, "USD").format()
    email = _email(
        "github-copilot-seats",
        date(2026, 8, 27),
        "billing@github.com",
        f"Seats removed on invoice {invoice}",
        "Hi Dana,\n\nWe've removed the 48 unused Copilot Business seats from your "
        f"organization. A refund of {amount} for invoice {invoice} has been issued to your "
        f"card ending in {_CARD} and should appear within 5-7 business days.\n\nThanks,\n"
        "GitHub Billing",
    )
    charge = _txn(
        "github-copilot-seats", "charge", date(2026, 8, 14), time(13, 27), "GITHUB", 91_200, invoice
    )
    return PastClaim(
        "github-copilot-seats",
        LeakType.MISSING_REFUND,
        (charge.id,),
        (charge,),
        found_on=date(2026, 9, 11),
        sent_on=date(2026, 9, 13),
        emails=(email,),
        reply=None,
    )


def in_flight_claims() -> list[PastClaim]:
    """Requests that are out but not paid: two unanswered, one question back, two agreed."""
    return [
        _github(),
        # Not in the vendor directory, so these two went to the card issuer.
        _charged_twice(
            "datadog-september",
            "DATADOG",
            184_732,
            "DDG-771204",
            date(2026, 9, 21),
            found_on=date(2026, 9, 23),
            sent_on=date(2026, 9, 24),
            reply="agreed",
        ),
        _charged_twice(
            "zendesk-september",
            "ZENDESK",
            137_445,
            "ZDK-418827",
            date(2026, 9, 25),
            found_on=date(2026, 9, 27),
            sent_on=date(2026, 9, 28),
            reply=None,
        ),
        _charged_twice(
            "notion-seats",
            "NOTION LABS",
            32_640,
            "NTN-SEATS-202609",
            date(2026, 9, 22),
            found_on=date(2026, 9, 23),
            sent_on=date(2026, 9, 24),
            reply="needs_info",
            reply_after=timedelta(days=1),
        ),
        _charged_twice(
            "zoom-webinars",
            "ZOOM.US",
            74_792,
            "ZMW-309155",
            date(2026, 9, 23),
            found_on=date(2026, 9, 25),
            sent_on=date(2026, 9, 26),
            reply="agreed",
        ),
    ]


# (slug, card descriptor, invoice reference, found, sent, credited)
_BILLED_TWICE = (
    (
        "google-workspace-june",
        "GOOGLE WORKSPACE",
        "GWS-202606",
        date(2026, 6, 3),
        date(2026, 6, 4),
        date(2026, 6, 11),
    ),
    (
        "aws-june",
        "AMAZON WEB SERVICES",
        "AWS-202606",
        date(2026, 6, 4),
        date(2026, 6, 5),
        date(2026, 6, 17),
    ),
    (
        "linear-august",
        "LINEAR APP",
        "LIN-202608",
        date(2026, 8, 17),
        date(2026, 8, 18),
        date(2026, 8, 25),
    ),
)


def past_claims(ledger: Sequence[Transaction]) -> list[PastClaim]:
    """The script: claims already won, then those in flight. Copied invoices must be in `ledger`."""
    invoices: dict[tuple[str, str | None], Transaction] = {}
    for txn in sorted(ledger, key=lambda t: (t.posted_at, t.id)):
        if txn.is_debit:
            invoices.setdefault((txn.merchant, txn.reference), txn)

    claims = [_staples(), _wework(), _amazon(), _calendly(), _dell()]
    for slug, merchant, reference, found_on, sent_on, credited_on in _BILLED_TWICE:
        invoice = invoices.get((merchant, reference))
        if invoice is not None:
            claims.append(_billed_twice(slug, invoice, found_on, sent_on, credited_on))
    claims.extend(in_flight_claims())
    return sorted(claims, key=lambda c: (c.credit is None, c.found_on, c.slug))


def _ledger(session: Session) -> list[Transaction]:
    rows = session.scalars(select(TransactionRow).order_by(TransactionRow.posted_at)).all()
    return [row_to_transaction(row) for row in rows]


def _replay(
    session: Session,
    settings: Settings,
    services: Services,
    sources: Sources,
    claim: PastClaim,
    ledger: Sequence[Transaction],
    promises: Sequence[Promise],
) -> int | None:
    """Flag, draft, send, and receive the vendor's answer, on the dates it happened.

    Returns the finding's id, or None when the claim could not be replayed.
    """
    # What Recoup could see that day: nothing posted or written later.
    seen = DetectionInput(
        [t for t in ledger if t.posted_at.date() <= claim.found_on],
        [p for p in promises if p.promised_at.date() <= claim.found_on],
        sources,
        claim.found_on,
    )
    candidate = next(
        (
            c
            for detect in detectors_from_settings(settings)
            for c in detect(seen)
            if c.leak_type is claim.leak_type and set(c.transaction_ids) == set(claim.flagged)
        ),
        None,
    )
    if candidate is None:
        logger.warning("history: no detector flagged %s on %s", claim.slug, claim.found_on)
        return None

    upsert_finding(session, candidate, display_merchant(candidate, sources), claim.found_on)
    row = session.scalars(select(FindingRow).where(FindingRow.key == candidate.key)).one()
    if row.status != Status.OPEN:
        return None
    row.created_at = datetime.combine(claim.found_on, time(12), tzinfo=UTC)
    draft = create_draft(
        session,
        row,
        vendors=sources.vendors,
        drafter=services.drafter,
        as_of=claim.found_on,
        card_dispute_address=settings.card_dispute_address,
        actor=APPROVER,
    )
    send_draft(session, draft, outbox=services.outbox, as_of=claim.sent_on, actor=APPROVER)
    assert draft.sent_at is not None

    if claim.reply is not None:
        amount = Money(row.amount_minor, row.currency).format()
        body = reply_body(claim.reply, amount, is_issuer=draft.channel == "card_dispute")
        replied_at = draft.sent_at + claim.reply_after
        ingest_emails(session, [reply_email(draft, draft.to_addr, body, replied_at)])
    return row.id


def replay_history(
    session: Session, settings: Settings, services: Services, sources: Sources
) -> HistorySummary | None:
    """Add the past claims that are not in the database yet. None when there are none,
    and always None unless RECOUP_DEMO_HISTORY=true.

    Safe to call on every run: a claim whose charge is already in the ledger is skipped,
    so a database that has some of the script gets only the rest.
    """
    if not settings.demo_history:
        return None
    as_of = get_as_of(session, settings)
    claims = [
        claim
        for claim in past_claims(_ledger(session))
        if claim.last_event_on <= as_of and session.get(TransactionRow, claim.charges[0].id) is None
    ]
    if not claims:
        return None

    ingest_transactions(session, [txn for claim in claims for txn in claim.ledger])
    ingest_emails(session, [email for claim in claims for email in claim.emails])
    session.flush()
    timing = PromiseTiming(settings.promise_default_days, settings.promise_grace_days)
    inbox = read_inbox(session, services.extractor, services.classifier, sources.vendors, timing)
    ledger = _ledger(session)
    replayed = [
        _replay(session, settings, services, sources, claim, ledger, inbox.promises)
        for claim in claims
    ]
    finding_ids = [finding_id for finding_id in replayed if finding_id is not None]
    session.flush()

    # The replies and credits are in; from here it is an ordinary run.
    run = run_pipeline(session, settings, services, sources)
    rows = session.scalars(select(FindingRow).where(FindingRow.id.in_(finding_ids))).all()
    recovered = [row for row in rows if row.status == Status.RECOVERED]
    in_flight = [row for row in rows if STAGE_OF[Status(row.status)] is Stage.WAITING]
    return HistorySummary(
        claims=len(rows),
        recovered=len(recovered),
        recovered_minor=sum(row.recovered_minor or 0 for row in recovered),
        in_flight=len(in_flight),
        in_flight_minor=sum(row.amount_minor for row in in_flight),
        run=run,
    )
