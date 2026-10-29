"""The non-ledger sources Recoup reads: vendor email, the vendor directory,
contracts, and public status-page incidents. Plus `Promise`, the validated
commitment a vendor made in writing.
"""

import hashlib
from datetime import UTC, date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

PromiseKind = Literal["refund", "credit", "cancellation"]


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def email_key(message_id: str) -> str:
    """Stable id from the RFC 5322 Message-ID, so re-ingesting a mailbox is a no-op."""
    return f"eml_{hashlib.sha256(message_id.encode()).hexdigest()[:16]}"


def sender_domain(address: str) -> str:
    return address.rsplit("@", 1)[-1].strip().lower().rstrip(">")


class Email(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    message_id: str
    thread_id: str
    in_reply_to: str | None = None
    from_addr: str
    to_addr: str
    subject: str
    sent_at: datetime
    body: str

    @field_validator("sent_at")
    @classmethod
    def _sent_at_utc(cls, value: datetime) -> datetime:
        return _utc(value)


class Vendor(BaseModel):
    """One entry in the vendor directory. Recipients always come from here,
    never from email content, so a crafted email cannot redirect a recovery."""

    model_config = ConfigDict(frozen=True)

    key: str  # normalized card descriptor
    name: str
    support_email: str
    domains: tuple[str, ...]
    aliases: tuple[str, ...] = ()

    def sends_from(self, address: str) -> bool:
        domain = sender_domain(address)
        return any(domain == d or domain.endswith(f".{d}") for d in self.domains)


class SlaTier(BaseModel):
    model_config = ConfigDict(frozen=True)

    # Uptime in basis points of 100% (99.9% == 9_990), so no float comparisons.
    below_bp: int
    credit_pct: int


class Contract(BaseModel):
    model_config = ConfigDict(frozen=True)

    vendor_key: str
    plan: str
    document: str
    sla_target_bp: int | None = None
    tiers: tuple[SlaTier, ...] = ()
    claim_window_days: int = 30
    clause: str = ""


class Incident(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    vendor_key: str
    title: str
    started_at: datetime
    ended_at: datetime
    status_url: str

    @field_validator("started_at", "ended_at")
    @classmethod
    def _times_utc(cls, value: datetime) -> datetime:
        return _utc(value)


class Promise(BaseModel):
    """A vendor commitment that passed every code-level check: verified sender,
    verbatim quote, parseable amount. Only these can become findings."""

    model_config = ConfigDict(frozen=True)

    email_id: str
    vendor_key: str
    vendor_name: str
    kind: PromiseKind
    amount_minor: int | None
    currency: str
    reference: str | None
    promised_at: datetime
    due_by: date
    effective_on: date | None
    quote: str
