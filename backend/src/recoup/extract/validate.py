"""Code-level checks between model output and anything that can become a finding.

Each check holds even if the model is fully compromised by a crafted email:

1. Verified sender: the email must come from a domain in the vendor directory.
2. Grounding: the quote must appear verbatim in the email body.
3. Amount: it must parse exactly as money and equal a number written in the quote.
4. Reference: dropped if it does not appear in the email.
5. Cancellation date: used only if the email states it and it is near the email's
   date; otherwise the email's own date is the effective date.

Nothing here can suppress a finding or choose a recipient. Those paths do not
read model output at all.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from recoup.domain.money import MINOR_UNIT_EXPONENTS, Money
from recoup.domain.sources import Email, Promise
from recoup.domain.vendors import VendorDirectory
from recoup.extract.schema import EmailExtraction, ExtractedPromise

MIN_QUOTE_CHARS = 12
MAX_PROMISED_DAYS = 120
MAX_EFFECTIVE_DRIFT_DAYS = 45
_SPACE = re.compile(r"\s+")
_NUMBER = re.compile(r"(?<![\d.])\d[\d,]*(?:\.\d+)?")


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


def _decimal(text: str) -> Decimal | None:
    try:
        return Decimal(text.replace(",", ""))
    except InvalidOperation:
        return None


def _amount_in_quote(amount: str, quote: str) -> bool:
    """The amount equals a whole number in the quote: "250.00" does not match "$1,250.00"."""
    wanted = _decimal(amount)
    return wanted is not None and any(_decimal(n) == wanted for n in _NUMBER.findall(quote))


def _parse_amount(item: ExtractedPromise) -> int | None:
    if item.amount is None:
        return None
    currency = item.currency or "USD"
    if currency not in MINOR_UNIT_EXPONENTS:
        raise ValueError(f"unsupported currency {currency!r}")
    return Money.parse(item.amount, currency).amount_minor


def _date_written(day: date, body: str) -> bool:
    month = day.strftime("%B")
    forms = (
        day.isoformat(),
        f"{month} {day.day}",
        f"{month[:3]} {day.day}",
        f"{day.day} {month}",
        f"{day.month}/{day.day}",
    )
    lowered = body.lower()
    return any(re.search(rf"(?<!\d){re.escape(f.lower())}(?!\d)", lowered) for f in forms)


def _effective_on(item: ExtractedPromise, email: Email) -> date | None:
    """A model-chosen date could hide real charges (too late) or invent them (too early)."""
    if item.kind != "cancellation":
        return None
    sent = email.sent_at.date()
    if not item.effective_date:
        return sent
    try:
        claimed = date.fromisoformat(item.effective_date)
    except ValueError:
        return sent
    is_near = abs((claimed - sent).days) <= MAX_EFFECTIVE_DRIFT_DAYS
    return claimed if is_near and _date_written(claimed, email.body) else sent


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
