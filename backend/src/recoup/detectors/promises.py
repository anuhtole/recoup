"""Broken promises: a vendor said money was coming back, and the ledger disagrees.

Refund or credit promise:
- link it to the original charge (by reference, else by amount, at that vendor)
- a matching credit posted              -> promise kept, ignored
- not yet past its due date             -> pending, ignored
- past due, amount stated               -> Recoverable
- past due, no amount stated            -> Needs review (amount = the original charge)
- cannot be linked to any charge        -> ignored (nothing to recover against)

Cancellation: any charge after the effective date is Recoverable.

Text can only ever *add* a finding for a person to review. Whether money posted is
read from the ledger alone, so no email can make a real leak disappear.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from recoup.detectors.vendor_keys import vendor_key
from recoup.domain.dates import human_date
from recoup.domain.money import Money
from recoup.domain.sources import Promise
from recoup.domain.types import Evidence, FindingCandidate, LeakType, Outcome, Transaction
from recoup.domain.vendors import VendorDirectory

DETECTOR_VERSION = "promises/1"


@dataclass(frozen=True, slots=True)
class PromiseConfig:
    min_amount_minor: int = 2_500
    dispute_window_days: int = 120
    link_lookback_days: int = 180
    # A refund can post slightly before the confirmation email arrives.
    credit_lead_days: int = 2


@dataclass
class _Ledger:
    debits: dict[str, list[Transaction]]
    credits: dict[str, list[Transaction]]

    @classmethod
    def build(cls, transactions: Sequence[Transaction], vendors: VendorDirectory) -> "_Ledger":
        debits: dict[str, list[Transaction]] = {}
        credits: dict[str, list[Transaction]] = {}
        for txn in sorted(transactions, key=lambda t: (t.posted_at, t.id)):
            bucket = debits if txn.is_debit else credits
            bucket.setdefault(vendor_key(txn, vendors), []).append(txn)
        return cls(debits, credits)


def _link(promise: Promise, ledger: _Ledger, config: PromiseConfig) -> Transaction | None:
    earliest = promise.promised_at - timedelta(days=config.link_lookback_days)
    window = [
        t
        for t in ledger.debits.get(promise.vendor_key, [])
        if earliest <= t.posted_at <= promise.promised_at
    ]
    if promise.reference:
        matches = [t for t in window if t.reference == promise.reference]
    elif promise.amount_minor is not None:
        matches = [t for t in window if t.amount_minor >= promise.amount_minor]
    else:
        matches = []
    return matches[-1] if matches else None


def _claim_credit(promise: Promise, original: Transaction, ledger: _Ledger, lead: int) -> bool:
    pending = ledger.credits.get(promise.vendor_key, [])
    earliest = promise.promised_at - timedelta(days=lead)
    reference = promise.reference or original.reference
    for index, credit in enumerate(pending):
        if credit.posted_at < earliest:
            continue
        if promise.amount_minor is not None and -credit.amount_minor != promise.amount_minor:
            continue
        if reference and credit.reference and credit.reference != reference:
            continue
        if promise.amount_minor is None and credit.reference != reference:
            continue
        pending.pop(index)
        return True
    return False


def _email_evidence(promise: Promise) -> Evidence:
    return Evidence(
        kind="email",
        ref=promise.email_id,
        detail=f'{promise.vendor_name} wrote on {promise.promised_at.date()}: "{promise.quote}"',
    )


def _txn_evidence(txn: Transaction) -> Evidence:
    reference = txn.reference or "no reference"
    detail = f"{txn.posted_at.date()} {txn.merchant} {txn.money.format()} ({reference})"
    return Evidence(kind="transaction", ref=txn.id, detail=detail)


def _broken_refund(
    promise: Promise, original: Transaction, config: PromiseConfig
) -> FindingCandidate | None:
    amount = promise.amount_minor if promise.amount_minor is not None else original.amount_minor
    if amount < config.min_amount_minor:
        return None
    money = Money(amount, original.currency).format()
    noun = "credit" if promise.kind == "credit" else "refund"
    if promise.amount_minor is None:
        outcome = Outcome.NEEDS_REVIEW
        reason = (
            f"{promise.vendor_name} promised a {noun} on {human_date(promise.promised_at)} but did "
            f"not say how much, and nothing has posted. The original charge was {money}; "
            "confirm the amount before asking for it."
        )
    else:
        outcome = Outcome.RECOVERABLE
        reason = (
            f"{promise.vendor_name} promised a {money} {noun} on "
            f"{human_date(promise.promised_at)}, due by {human_date(promise.due_by)}. "
            "No matching credit has posted."
        )
    rule = Evidence(
        kind="rule",
        ref=DETECTOR_VERSION,
        detail=(
            f"Searched every credit from {promise.vendor_name} after the email; none matches "
            f"{money}. The promise was due by {promise.due_by}."
        ),
    )
    return FindingCandidate(
        leak_type=LeakType.MISSING_REFUND,
        outcome=outcome,
        merchant=promise.vendor_name,
        transaction_ids=(original.id,),
        source_refs=(promise.email_id,),
        amount_minor=amount,
        currency=original.currency,
        reason=reason,
        evidence=(_email_evidence(promise), _txn_evidence(original), rule),
        detector_version=DETECTOR_VERSION,
        recover_by=original.posted_at.date() + timedelta(days=config.dispute_window_days),
    )


def _billed_after_cancel(
    promise: Promise, ledger: _Ledger, config: PromiseConfig
) -> FindingCandidate | None:
    effective = promise.effective_on or promise.promised_at.date()
    after = [t for t in ledger.debits.get(promise.vendor_key, []) if t.posted_at.date() > effective]
    total = sum(t.amount_minor for t in after)
    if not after or total < config.min_amount_minor:
        return None
    currency = after[0].currency
    money = Money(total, currency).format()
    rule = Evidence(
        kind="rule",
        ref=DETECTOR_VERSION,
        detail=f"{len(after)} charge(s) posted after the cancellation took effect on {effective}.",
    )
    return FindingCandidate(
        leak_type=LeakType.CHARGED_AFTER_CANCELLATION,
        outcome=Outcome.RECOVERABLE,
        merchant=promise.vendor_name,
        transaction_ids=tuple(t.id for t in after),
        source_refs=(promise.email_id,),
        amount_minor=total,
        currency=currency,
        reason=(
            f"{promise.vendor_name} confirmed the cancellation on {human_date(effective)}, "
            f"then charged {len(after)} more time(s), {money} in total."
        ),
        evidence=(_email_evidence(promise), *(_txn_evidence(t) for t in after), rule),
        detector_version=DETECTOR_VERSION,
        recover_by=after[0].posted_at.date() + timedelta(days=config.dispute_window_days),
    )


def detect_broken_promises(
    transactions: Sequence[Transaction],
    promises: Sequence[Promise],
    vendors: VendorDirectory,
    as_of: date,
    config: PromiseConfig | None = None,
) -> list[FindingCandidate]:
    config = config or PromiseConfig()
    ledger = _Ledger.build(transactions, vendors)
    findings: list[FindingCandidate] = []
    for promise in sorted(promises, key=lambda p: (p.promised_at, p.email_id)):
        if promise.kind == "cancellation":
            finding = _billed_after_cancel(promise, ledger, config)
        else:
            original = _link(promise, ledger, config)
            if original is None:
                continue
            if _claim_credit(promise, original, ledger, config.credit_lead_days):
                continue
            if as_of <= promise.due_by:
                continue
            finding = _broken_refund(promise, original, config)
        if finding is not None:
            findings.append(finding)
    return findings
