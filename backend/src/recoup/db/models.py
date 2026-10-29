"""Database schema.

Amounts are BigInteger minor units. Timestamps are timezone-aware UTC.
`audit_events` is append-only: rows are inserted, never updated or deleted.
"""

from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


def utcnow() -> datetime:
    return datetime.now(UTC)


class UtcDateTime(TypeDecorator[datetime]):
    """Timezone-aware UTC on every backend. SQLite drops tzinfo on read; this restores it."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class Base(DeclarativeBase):
    pass


class TransactionRow(Base):
    __tablename__ = "transactions"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_transactions_source_ext"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source: Mapped[str] = mapped_column(String(64))
    external_id: Mapped[str] = mapped_column(String(128))
    posted_at: Mapped[datetime] = mapped_column(UtcDateTime(), index=True)
    merchant: Mapped[str] = mapped_column(String(255))
    merchant_norm: Mapped[str] = mapped_column(String(255), index=True)
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    reference: Mapped[str | None] = mapped_column(String(128))
    card_last4: Mapped[str | None] = mapped_column(String(4))
    ingested_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)


class FindingRow(Base):
    __tablename__ = "findings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(512), unique=True)
    leak_type: Mapped[str] = mapped_column(String(32), index=True)
    outcome: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(32), default="open")
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    reason: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    transaction_ids: Mapped[list[str]] = mapped_column(JSON)
    detector_version: Mapped[str] = mapped_column(String(64))
    recover_by: Mapped[date | None] = mapped_column(Date)
    merchant: Mapped[str] = mapped_column(String(255), default="", server_default="")
    source_refs: Mapped[list[str]] = mapped_column(JSON, default=list, server_default=text("'[]'"))
    recovered_minor: Mapped[int | None] = mapped_column(BigInteger)
    recovered_txn_id: Mapped[str | None] = mapped_column(String(32))
    recovered_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    dismissed_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow, onupdate=utcnow)


class EmailRow(Base):
    __tablename__ = "emails"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    message_id: Mapped[str] = mapped_column(String(255), unique=True)
    thread_id: Mapped[str] = mapped_column(String(255), index=True)
    in_reply_to: Mapped[str | None] = mapped_column(String(255), index=True)
    from_addr: Mapped[str] = mapped_column(String(255))
    to_addr: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(500))
    sent_at: Mapped[datetime] = mapped_column(UtcDateTime(), index=True)
    body: Mapped[str] = mapped_column(Text)
    ingested_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)


class ExtractionRow(Base):
    """Cached model (or baseline) output per email and extractor version.

    Re-running the pipeline never pays for the same email twice.
    """

    __tablename__ = "extractions"
    __table_args__ = (UniqueConstraint("email_id", "extractor", name="uq_extractions_email"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email_id: Mapped[str] = mapped_column(ForeignKey("emails.id"), index=True)
    extractor: Mapped[str] = mapped_column(String(128))
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)


class DraftRow(Base):
    """A recovery request. It leaves the building only after a person approves it."""

    __tablename__ = "drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    finding_id: Mapped[int] = mapped_column(ForeignKey("findings.id"), index=True)
    channel: Mapped[str] = mapped_column(String(32))
    to_addr: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text)
    drafter: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(16), default="draft")
    message_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    sent_by: Mapped[str | None] = mapped_column(String(64))
    sent_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    created_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow, onupdate=utcnow)


class StateRow(Base):
    """Small key-value state, e.g. the demo clock."""

    __tablename__ = "system_state"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(255))


class AuditEventRow(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(UtcDateTime(), default=utcnow)
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64), index=True)
    finding_id: Mapped[int | None] = mapped_column(ForeignKey("findings.id"), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
