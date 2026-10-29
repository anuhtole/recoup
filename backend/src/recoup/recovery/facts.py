"""Everything a drafter may say about a case, assembled by code from stored records."""

from dataclasses import dataclass
from datetime import date

from recoup.domain.money import Money
from recoup.domain.sources import Vendor
from recoup.domain.types import Evidence, LeakType, Transaction


@dataclass(frozen=True)
class CaseFacts:
    finding_id: int
    leak_type: LeakType
    merchant: str
    vendor: Vendor | None
    amount_minor: int
    currency: str
    reason: str
    transactions: tuple[Transaction, ...]
    evidence: tuple[Evidence, ...]
    as_of: date
    is_escalation: bool = False

    @property
    def amount(self) -> str:
        return Money(self.amount_minor, self.currency).format()

    @property
    def references(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(t.reference for t in self.transactions if t.reference))

    @property
    def card_last4(self) -> str | None:
        return next((t.card_last4 for t in self.transactions if t.card_last4), None)

    def evidence_of(self, kind: str) -> tuple[Evidence, ...]:
        return tuple(e for e in self.evidence if e.kind == kind)
