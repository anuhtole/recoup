"""Rows in an upload that are already on file from another source.

The same charge can reach Recoup twice: a Ramp sync and a card export, or two exports
whose dates overlap but whose account names differ. Stored twice, every such charge
would look like a duplicate, and Recoup would ask the vendor for money it isn't owed.
So before an import, each row is matched against what other sources already hold.
"""

from collections import Counter
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from recoup.db.models import TransactionRow
from recoup.domain.merchants import normalize_merchant
from recoup.domain.types import Transaction

# Feeds and exports can disagree on the posting day by one (time zones, cut-offs).
_DAY_SLACK = timedelta(days=1)

_Match = tuple[str, int, str, date]


def _key(merchant_norm: str, amount_minor: int, currency: str, day: date) -> _Match:
    return (merchant_norm, amount_minor, currency, day)


def _start_of(day: date) -> datetime:
    return datetime.combine(day, time(), tzinfo=UTC)


def _same_or_missing(a: str | None, b: str | None) -> bool:
    return a is None or b is None or a == b


def split_overlaps(
    session: Session, transactions: Sequence[Transaction]
) -> tuple[list[Transaction], list[Transaction]]:
    """(rows to import, rows another source already holds). Each stored row matches once."""
    if not transactions:
        return [], []
    sources = {t.source for t in transactions}
    # Whole days, so a stored row late on the day after the last upload row still counts.
    first = _start_of(min(t.posted_at for t in transactions).date() - _DAY_SLACK)
    end = _start_of(max(t.posted_at for t in transactions).date() + _DAY_SLACK * 2)
    stored = session.scalars(
        select(TransactionRow).where(
            TransactionRow.source.not_in(sources),
            TransactionRow.posted_at >= first,
            TransactionRow.posted_at < end,
        )
    ).all()
    by_key: dict[_Match, list[TransactionRow]] = {}
    for row in stored:
        key = _key(row.merchant_norm, row.amount_minor, row.currency, row.posted_at.date())
        by_key.setdefault(key, []).append(row)

    used: Counter[str] = Counter()
    fresh: list[Transaction] = []
    overlapping: list[Transaction] = []
    for txn in transactions:
        match = _take_match(txn, by_key, used)
        (overlapping if match else fresh).append(txn)
    return fresh, overlapping


def _take_match(
    txn: Transaction, by_key: dict[_Match, list[TransactionRow]], used: Counter[str]
) -> bool:
    norm = normalize_merchant(txn.merchant)
    day = txn.posted_at.date()
    for offset in (0, -1, 1):
        for row in by_key.get(
            _key(norm, txn.amount_minor, txn.currency, day + timedelta(offset)), []
        ):
            if used[row.id]:
                continue
            if _same_or_missing(row.reference, txn.reference) and _same_or_missing(
                row.card_last4, txn.card_last4
            ):
                used[row.id] += 1
                return True
    return False
