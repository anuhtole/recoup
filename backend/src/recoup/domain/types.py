"""Domain models shared by ingest, detectors, the pipeline, and the API."""

import hashlib
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from recoup.domain.money import MINOR_UNIT_EXPONENTS, Money


class LeakType(StrEnum):
    DUPLICATE_CHARGE = "duplicate_charge"
    MISSING_REFUND = "missing_refund"
    CHARGED_AFTER_CANCELLATION = "charged_after_cancellation"
    SLA_CREDIT = "sla_credit"


class Outcome(StrEnum):
    """Discrete outcomes instead of model-generated confidence scores.

    Needs review is a normal outcome, not an error: it means the evidence is
    real but a person should confirm before anything is sent.
    """

    RECOVERABLE = "recoverable"
    NOT_RECOVERABLE = "not_recoverable"
    NEEDS_REVIEW = "needs_review"


def transaction_key(source: str, external_id: str) -> str:
    """Stable id for a transaction, so re-ingesting the same feed never duplicates rows."""
    digest = hashlib.sha256(f"{source}:{external_id}".encode()).hexdigest()
    return f"txn_{digest[:16]}"


class Transaction(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    source: str
    external_id: str
    posted_at: datetime
    merchant: str
    amount_minor: int
    currency: str
    reference: str | None = None
    card_last4: str | None = None

    @field_validator("posted_at")
    @classmethod
    def _to_utc(cls, value: datetime) -> datetime:
        # Databases like SQLite drop tzinfo; Recoup stores and compares everything in UTC.
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    @field_validator("currency")
    @classmethod
    def _supported_currency(cls, value: str) -> str:
        if value not in MINOR_UNIT_EXPONENTS:
            raise ValueError(f"Unsupported currency: {value!r}")
        return value

    @property
    def money(self) -> Money:
        return Money(self.amount_minor, self.currency)

    @property
    def is_debit(self) -> bool:
        return self.amount_minor > 0


EvidenceKind = Literal["transaction", "email", "contract", "incident", "rule", "note"]


class Evidence(BaseModel):
    """One citation behind a finding: a transaction, an email quote, a contract
    clause, a status-page incident, the rule applied, or a note."""

    model_config = ConfigDict(frozen=True)

    kind: EvidenceKind
    ref: str
    detail: str


class FindingCandidate(BaseModel):
    """What a detector proposes. The pipeline decides whether it is new or changed."""

    model_config = ConfigDict(frozen=True)

    leak_type: LeakType
    outcome: Outcome
    merchant: str = ""
    transaction_ids: tuple[str, ...]
    # Non-ledger sources the finding rests on: email ids, incident ids.
    source_refs: tuple[str, ...] = ()
    amount_minor: int
    currency: str
    reason: str
    evidence: tuple[Evidence, ...]
    detector_version: str
    recover_by: date | None = None

    @field_validator("transaction_ids", "source_refs")
    @classmethod
    def _sorted_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return tuple(sorted(value))

    @property
    def key(self) -> str:
        """Identity used for idempotency: re-running detection never duplicates a finding.

        A cancellation is one case per confirmation email: later charges grow that
        case instead of opening an overlapping one.
        """
        grows = self.leak_type is LeakType.CHARGED_AFTER_CANCELLATION and self.source_refs
        ids = () if grows else self.transaction_ids
        key = f"{self.leak_type.value}:{'|'.join(ids)}"
        return f"{key}#{'|'.join(self.source_refs)}" if self.source_refs else key
