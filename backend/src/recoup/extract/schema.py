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


class ExtractedTier(BaseModel):
    below_uptime_pct: str = Field(
        description="The uptime this credit applies below, as written, e.g. '99.9'."
    )
    credit_pct: int = Field(description="Service credit as a whole percent of the fee, e.g. 10.")


class ContractReading(BaseModel):
    """What one order form or MSA commits the vendor to. Every field is a proposal."""

    vendor_name: str = Field(description="The vendor's company or product name as written.")
    plan: str = Field(description="The plan, edition, or tier purchased, e.g. 'Business'.")
    uptime_commitment_pct: str | None = Field(
        description="The committed monthly or quarterly uptime as written, e.g. '99.9'. "
        "null if the document makes no uptime commitment."
    )
    sla_clause: str | None = Field(
        description="The sentence that states the uptime commitment, copied exactly. null if none."
    )
    credit_tiers: list[ExtractedTier] = Field(
        description="Each service-credit tier the document states. Empty if none."
    )
    claim_window_days: int | None = Field(
        description="Days the customer has to request a credit, in calendar days, or null."
    )
    measurement_period: Literal["month", "quarter"] | None = Field(
        description="Whether uptime is measured per calendar month or quarter, or null."
    )
    covered_components: list[str] = Field(
        description="Named services or components the SLA covers, as written. Empty if the "
        "whole service is covered or nothing is named."
    )
    price_per_period: str | None = Field(
        description="The recurring fee per billing charge, digits and decimal point only, e.g. "
        "'480.00'. null if no fee is stated."
    )
    price_currency: str | None = Field(description="ISO 4217 code of the fee, e.g. 'USD'.")
    price_locked_until: str | None = Field(
        description="The YYYY-MM-DD date until which the fee may not change, or null."
    )
    price_increase_cap_pct: str | None = Field(
        description="The most the fee may rise at renewal or after the lock, as a percent, "
        "e.g. '7'. null if not stated."
    )
    price_clause: str | None = Field(
        description="The sentence that states the fee, copied exactly. null if none."
    )
