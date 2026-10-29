"""Duplicate charge detection.

Two debits are a candidate duplicate when they share a normalized merchant,
currency, and exact amount, and post within a short window. Then:

- both carry the same order or invoice reference  -> Recoverable
- both carry different references                 -> separate purchases, ignored
- at least one reference is missing               -> Needs review
- below the minimum amount                        -> ignored (not worth a vendor email)
- a matching credit already posted                -> already refunded, ignored
"""

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta
from itertools import pairwise

from recoup.domain.dates import human_date
from recoup.domain.merchants import normalize_merchant
from recoup.domain.types import Evidence, FindingCandidate, LeakType, Outcome, Transaction

DETECTOR_VERSION = "duplicates/1"


@dataclass(frozen=True, slots=True)
class DuplicateConfig:
    window_days: int = 3
    min_amount_minor: int = 2_500
    dispute_window_days: int = 120


_GroupKey = tuple[str, str, int]


def _group_key(txn: Transaction) -> _GroupKey:
    return (normalize_merchant(txn.merchant), txn.currency, abs(txn.amount_minor))


def _refund_index(credits: Sequence[Transaction]) -> dict[_GroupKey, list[Transaction]]:
    index: dict[_GroupKey, list[Transaction]] = defaultdict(list)
    for credit in sorted(credits, key=lambda t: t.posted_at):
        index[_group_key(credit)].append(credit)
    return index


def _consume_refund(
    refunds: dict[_GroupKey, list[Transaction]], key: _GroupKey, duplicate: Transaction
) -> Transaction | None:
    """Claim the first unused credit that plausibly reverses `duplicate`.

    It must share merchant and amount, post after the duplicate, and, when both
    sides carry a reference, carry the same one. A return for a different order
    of the same amount must not hide a real duplicate.
    """
    pending = refunds.get(key, [])
    for index, credit in enumerate(pending):
        if credit.posted_at < duplicate.posted_at:
            continue
        if duplicate.reference and credit.reference and credit.reference != duplicate.reference:
            continue
        return pending.pop(index)
    return None


def _describe(original: Transaction, duplicate: Transaction, outcome: Outcome) -> str:
    amount = original.money.format()
    first, second = human_date(original.posted_at), human_date(duplicate.posted_at)
    if outcome is Outcome.RECOVERABLE:
        return (
            f"{original.merchant} charged {amount} twice, on {first} and {second}, "
            f"under the same reference {original.reference}. One charge should be refunded."
        )
    return (
        f"{original.merchant} charged {amount} twice, on {first} and {second}. "
        "There is no shared order reference to prove it was one purchase, "
        "so a person should confirm before we contact the vendor."
    )


def _evidence(
    original: Transaction, duplicate: Transaction, config: DuplicateConfig
) -> tuple[Evidence, ...]:
    def describe(txn: Transaction) -> str:
        reference = txn.reference or "no reference"
        return f"{txn.posted_at.date()} {txn.merchant} {txn.money.format()} ({reference})"

    gap_days = (duplicate.posted_at - original.posted_at).days
    return (
        Evidence(kind="transaction", ref=original.id, detail=describe(original)),
        Evidence(kind="transaction", ref=duplicate.id, detail=describe(duplicate)),
        Evidence(
            kind="rule",
            ref=DETECTOR_VERSION,
            detail=(
                f"Same merchant and exact amount {gap_days} day(s) apart "
                f"(window: {config.window_days} days); no matching refund has posted."
            ),
        ),
    )


def detect_duplicates(
    transactions: Sequence[Transaction], config: DuplicateConfig | None = None
) -> list[FindingCandidate]:
    config = config or DuplicateConfig()
    window = timedelta(days=config.window_days)

    groups: dict[_GroupKey, list[Transaction]] = defaultdict(list)
    for txn in transactions:
        if txn.is_debit:
            groups[_group_key(txn)].append(txn)
    refunds = _refund_index([t for t in transactions if not t.is_debit])

    findings: list[FindingCandidate] = []
    for key, debits in groups.items():
        if len(debits) < 2 or key[2] < config.min_amount_minor:
            continue
        ordered = sorted(debits, key=lambda t: (t.posted_at, t.id))
        for original, duplicate in pairwise(ordered):
            if duplicate.posted_at - original.posted_at > window:
                continue
            refs = (original.reference, duplicate.reference)
            if all(refs) and refs[0] != refs[1]:
                continue
            if _consume_refund(refunds, key, duplicate) is not None:
                continue

            outcome = Outcome.RECOVERABLE if all(refs) else Outcome.NEEDS_REVIEW
            findings.append(
                FindingCandidate(
                    leak_type=LeakType.DUPLICATE_CHARGE,
                    outcome=outcome,
                    merchant=original.merchant,
                    transaction_ids=(original.id, duplicate.id),
                    amount_minor=duplicate.amount_minor,
                    currency=duplicate.currency,
                    reason=_describe(original, duplicate, outcome),
                    evidence=_evidence(original, duplicate, config),
                    detector_version=DETECTOR_VERSION,
                    recover_by=(
                        duplicate.posted_at + timedelta(days=config.dispute_window_days)
                    ).date(),
                )
            )
    return findings
