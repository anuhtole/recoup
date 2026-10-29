"""Code-level checks between model output and anything that can become a finding.

Each check holds even if the model is fully compromised by a crafted email:

1. Verified sender: the email must come from a domain in the vendor directory.
2. Grounding: the quote must appear verbatim in the email body.
3. Amount: it must parse exactly as money and appear inside the quote.
4. Reference: dropped if it does not appear in the email.

Nothing here can suppress a finding or choose a recipient. Those paths do not
read model output at all.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta

from recoup.domain.money import MINOR_UNIT_EXPONENTS, Money
from recoup.domain.sources import Email, Promise
from recoup.domain.vendors import VendorDirectory
from recoup.extract.schema import EmailExtraction, ExtractedPromise

MIN_QUOTE_CHARS = 12
MAX_PROMISED_DAYS = 120
_SPACE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class Rejection:
    email_id: str
    reason: str
    detail: str


@dataclass(frozen=True, slots=True)
class PromiseTiming:
    default_days: int = 14
    grace_days: int = 3


def _squash(text: str) -> str:
    return _SPACE.sub(" ", text).strip()


def _amount_in_quote(amount: str, quote: str) -> bool:
    digits = amount.replace(",", "")
    return digits in quote.replace(",", "")


def _parse_amount(item: ExtractedPromise) -> int | None:
    if item.amount is None:
        return None
    currency = item.currency or "USD"
    if currency not in MINOR_UNIT_EXPONENTS:
        raise ValueError(f"unsupported currency {currency!r}")
    return Money.parse(item.amount, currency).amount_minor


def _effective_on(item: ExtractedPromise, email: Email) -> date | None:
    if item.kind != "cancellation":
        return None
    if item.effective_date:
        try:
            return date.fromisoformat(item.effective_date)
        except ValueError:
            pass
    return email.sent_at.date()


def _check(item: ExtractedPromise, email: Email) -> str | None:
    """The reason to reject this proposal, or None if it is grounded."""
    quote = _squash(item.quote)
    if len(quote) < MIN_QUOTE_CHARS:
        return "quote_too_short"
    if quote not in _squash(email.body):
        return "quote_not_in_email"
    if item.amount is not None:
        try:
            _parse_amount(item)
        except ValueError:
            return "amount_unparseable"
        if not _amount_in_quote(item.amount, quote):
            return "amount_not_in_quote"
    return None


def validate_extraction(
    email: Email,
    extraction: EmailExtraction,
    vendors: VendorDirectory,
    timing: PromiseTiming | None = None,
) -> tuple[list[Promise], list[Rejection]]:
    timing = timing or PromiseTiming()
    if not extraction.promises:
        return [], []
    vendor = vendors.for_sender(email.from_addr)
    if vendor is None:
        detail = f"{email.from_addr} is not a known vendor domain"
        return [], [Rejection(email.id, "unverified_sender", detail)]

    promises: list[Promise] = []
    rejections: list[Rejection] = []
    for item in extraction.promises:
        reason = _check(item, email)
        if reason is not None:
            rejections.append(Rejection(email.id, reason, item.quote[:200]))
            continue
        days = min(max(item.expected_within_days or timing.default_days, 0), MAX_PROMISED_DAYS)
        reference = item.reference if item.reference and item.reference in email.body else None
        promises.append(
            Promise(
                email_id=email.id,
                vendor_key=vendor.key,
                vendor_name=vendor.name,
                kind=item.kind,
                amount_minor=_parse_amount(item),
                currency=item.currency or "USD",
                reference=reference,
                promised_at=email.sent_at,
                due_by=email.sent_at.date() + timedelta(days=days + timing.grace_days),
                effective_on=_effective_on(item, email),
                quote=_squash(item.quote),
            )
        )
    return promises, rejections
