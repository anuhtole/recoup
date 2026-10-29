"""Typed outputs the model must return. These are proposals, not decisions."""

from typing import Literal

from pydantic import BaseModel, Field


class ExtractedPromise(BaseModel):
    kind: Literal["refund", "credit", "cancellation"] = Field(
        description=(
            "refund: money returned to the payment method. credit: a balance or card credit. "
            "cancellation: the vendor confirms a subscription or plan is cancelled."
        )
    )
    amount: str | None = Field(
        description="The amount exactly as written, digits and decimal point only, e.g. '612.40'. "
        "null if the email states no amount."
    )
    currency: str | None = Field(description="ISO 4217 code, e.g. 'USD'. null if no amount.")
    reference: str | None = Field(
        description="Order, invoice, folio, or confirmation number exactly as written, or null."
    )
    expected_within_days: int | None = Field(
        description="Calendar days from the email date by which the money should arrive. "
        "Convert business days to calendar days (7 business days = 10). null if not stated."
    )
    effective_date: str | None = Field(
        description="For cancellations only: the YYYY-MM-DD date the cancellation takes effect."
    )
    quote: str = Field(
        description="The sentence that makes the commitment, copied character for character."
    )


class EmailExtraction(BaseModel):
    promises: list[ExtractedPromise] = Field(
        description="Every commitment the vendor makes in this email. Empty if there are none."
    )


class ReplyAssessment(BaseModel):
    decision: Literal["agreed", "declined", "needs_info", "other"] = Field(
        description=(
            "agreed: the vendor will refund or credit. declined: the vendor refuses. "
            "needs_info: the vendor asks for something before deciding. other: none of these."
        )
    )
    amount: str | None = Field(description="Amount the vendor agreed to, as written, or null.")
    quote: str = Field(description="The sentence that shows the decision, copied exactly.")
    summary: str = Field(description="One plain sentence describing the reply.")
