"""Response and request models. The API contract is explicit and validated, never raw ORM rows."""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from recoup.domain.types import Evidence, LeakType, Outcome
from recoup.domain.workflow import Stage, Status


class TransactionOut(BaseModel):
    id: str
    posted_at: datetime
    merchant: str
    amount_minor: int
    currency: str
    reference: str | None
    card_last4: str | None


class NextActionOut(BaseModel):
    kind: Literal["draft", "review", "follow_up", "escalate", "wait", "none"]
    label: str


class FindingOut(BaseModel):
    id: int
    leak_type: LeakType
    outcome: Outcome
    status: Status
    stage: Stage
    merchant: str
    amount_minor: int
    currency: str
    reason: str
    recover_by: date | None
    days_left: int | None
    recovered_minor: int | None
    detector_version: str
    transaction_ids: list[str]
    source_refs: list[str]
    next_action: NextActionOut
    created_at: datetime


class EmailOut(BaseModel):
    id: str
    from_addr: str
    to_addr: str
    subject: str
    sent_at: datetime
    body: str
    in_reply_to: str | None


class DraftOut(BaseModel):
    id: int
    channel: Literal["vendor_email", "card_dispute"]
    to_addr: str
    subject: str
    body: str
    drafter: str
    status: Literal["draft", "sent"]
    sent_at: datetime | None
    sent_by: str | None


class TimelineEventOut(BaseModel):
    at: datetime
    kind: Literal[
        "charge",
        "promise",
        "incident",
        "detected",
        "drafted",
        "sent",
        "reply",
        "recovered",
        "dismissed",
        "deadline",
    ]
    title: str
    detail: str | None = None
    is_future: bool = False


class AuditEventOut(BaseModel):
    id: int
    occurred_at: datetime
    actor: str
    action: str
    payload: dict[str, Any]


class FindingDetailOut(FindingOut):
    evidence: list[Evidence]
    transactions: list[TransactionOut]
    emails: list[EmailOut]
    drafts: list[DraftOut]
    timeline: list[TimelineEventOut]
    trace: list[AuditEventOut]


class OutcomeTotal(BaseModel):
    outcome: Outcome
    count: int
    amount_minor: int


class StageCount(BaseModel):
    stage: Stage
    count: int


class SummaryOut(BaseModel):
    currency: str
    as_of: date
    mode: str
    demo_mode: bool
    claimable_minor: int
    in_flight_minor: int
    recovered_minor: int
    expired_minor: int
    totals: list[OutcomeTotal]
    stages: list[StageCount]


class RunSummaryOut(BaseModel):
    as_of: str
    transactions: int
    emails_read: int
    emails_extracted: int
    promises: int
    rejected: int
    model_errors: int
    replies: int
    created: int
    updated: int
    unchanged: int
    recovered: int


class AdvanceOut(BaseModel):
    previous_as_of: str
    as_of: str
    replies: int
    credits: int
    run: RunSummaryOut


class DraftUpdateIn(BaseModel):
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1, max_length=20_000)


class SendIn(BaseModel):
    # The UI sends this only from its confirmation dialog: an explicit human approval.
    confirm: Literal[True]
    approver: str = Field(default="reviewer", min_length=1, max_length=64)


class DismissIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class AdvanceIn(BaseModel):
    days: int = Field(default=14, ge=1, le=60)
