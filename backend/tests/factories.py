"""Small builders that keep test cases readable."""

import itertools
from datetime import UTC, date, datetime, time

from recoup.domain.sources import Email, email_key
from recoup.domain.types import Transaction, transaction_key
from recoup.domain.vendors import VendorDirectory
from recoup.extract.schema import ExtractedPromise
from recoup.synth.vendors import VENDORS

_counter = itertools.count(1)


def txn(
    day: str,
    merchant: str,
    amount_minor: int,
    reference: str | None = None,
    *,
    currency: str = "USD",
    hour: int = 12,
) -> Transaction:
    external_id = f"test_{next(_counter):05d}"
    posted_at = datetime.combine(date.fromisoformat(day), time(hour=hour), tzinfo=UTC)
    return Transaction(
        id=transaction_key("test", external_id),
        source="test",
        external_id=external_id,
        posted_at=posted_at,
        merchant=merchant,
        amount_minor=amount_minor,
        currency=currency,
        reference=reference,
    )


def email(
    body: str,
    *,
    sender: str = "billing@figma.com",
    day: str = "2026-06-10",
    subject: str = "About your account",
    in_reply_to: str | None = None,
) -> Email:
    message_id = f"<test-{next(_counter)}@{sender.rsplit('@', 1)[1]}>"
    return Email(
        id=email_key(message_id),
        message_id=message_id,
        thread_id=in_reply_to or message_id,
        in_reply_to=in_reply_to,
        from_addr=sender,
        to_addr="ap@northwind.example",
        subject=subject,
        sent_at=datetime.combine(date.fromisoformat(day), time(hour=10), tzinfo=UTC),
        body=body,
    )


def promised(
    quote: str,
    kind: str = "refund",
    amount: str | None = None,
    reference: str | None = None,
    days: int | None = None,
) -> ExtractedPromise:
    return ExtractedPromise.model_validate(
        {
            "kind": kind,
            "amount": amount,
            "currency": "USD" if amount else None,
            "reference": reference,
            "expected_within_days": days,
            "effective_date": None,
            "quote": quote,
        }
    )


def directory() -> VendorDirectory:
    return VendorDirectory(VENDORS)
