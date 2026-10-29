"""Shared builder for the synthetic world: adds transactions and records answer-key cases."""

import random
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time
from typing import Any, Literal

from recoup.domain.merchants import normalize_merchant
from recoup.domain.types import LeakType, Outcome, Transaction, transaction_key

SOURCE = "card_feed"

# Background spend never repeats a merchant + amount (at or above this) within this many days.
_GUARD_DAYS = 6
_GUARD_MIN_MINOR = 1_000

CaseKind = Literal["positive", "hard_negative"]


@dataclass
class LedgerBuilder:
    rng: random.Random
    transactions: list[Transaction] = field(default_factory=list)
    cases: list[dict[str, Any]] = field(default_factory=list)
    _seen: dict[tuple[str, int], list[date]] = field(default_factory=dict)

    def _posted_at(self, day: date) -> datetime:
        clock = time(hour=self.rng.randint(8, 21), minute=self.rng.randint(0, 59))
        return datetime.combine(day, clock, tzinfo=UTC)

    def _register(self, merchant: str, amount_minor: int, day: date) -> None:
        self._seen.setdefault((normalize_merchant(merchant), abs(amount_minor)), []).append(day)

    def _collides(self, merchant: str, amount_minor: int, day: date) -> bool:
        if abs(amount_minor) < _GUARD_MIN_MINOR:
            return False
        days = self._seen.get((normalize_merchant(merchant), abs(amount_minor)), [])
        return any(abs((day - other).days) <= _GUARD_DAYS for other in days)

    def add(
        self,
        day: date,
        merchant: str,
        amount_minor: int,
        reference: str | None = None,
        card_last4: str = "4417",
    ) -> Transaction:
        external_id = f"cf_{len(self.transactions) + 1:05d}"
        txn = Transaction(
            id=transaction_key(SOURCE, external_id),
            source=SOURCE,
            external_id=external_id,
            posted_at=self._posted_at(day),
            merchant=merchant,
            amount_minor=amount_minor,
            currency="USD",
            reference=reference,
            card_last4=card_last4,
        )
        self.transactions.append(txn)
        self._register(merchant, amount_minor, day)
        return txn

    def add_background(
        self, day: date, merchant: str, amount_minor: int, reference: str | None = None
    ) -> Transaction:
        """Add ordinary spend, nudging the amount until it cannot look like a duplicate."""
        while self._collides(merchant, amount_minor, day):
            amount_minor += self.rng.randint(1, 97)
        return self.add(day, merchant, amount_minor, reference)

    def case(
        self,
        case_id: str,
        kind: CaseKind,
        transactions: Sequence[Transaction],
        description: str,
        expected_outcome: Outcome | None = None,
        *,
        leak_type: LeakType = LeakType.DUPLICATE_CHARGE,
        source_refs: Sequence[str] = (),
        amount_minor: int | None = None,
    ) -> None:
        debits = [t for t in transactions if t.is_debit]
        if amount_minor is None:
            amount_minor = debits[-1].amount_minor if debits else 0
        self.cases.append(
            {
                "case_id": case_id,
                "kind": kind,
                "leak_type": leak_type.value,
                "expected_outcome": expected_outcome.value if expected_outcome else None,
                "transaction_ids": sorted(t.id for t in transactions),
                "source_refs": sorted(source_refs),
                "amount_minor": amount_minor,
                "description": description,
            }
        )

    def ref(self, prefix: str, digits: int = 6) -> str:
        return f"{prefix}{self.rng.randint(10 ** (digits - 1), 10**digits - 1)}"
