"""Price overcharges: the order form fixes a price, the card shows a higher one.

Per contract with a committed price, take the vendor's first charge each month
(a second charge in a month is a duplicate, which has its own detector) and
compare it with the price the contract allows on that date:

- while the price is locked, the contracted price
- after the lock, the contracted price plus the increase cap, if there is one
- after the lock with no cap, anything goes, so nothing is flagged

The overcharge is the difference. A later credit at the vendor of exactly that
difference, or of the whole charge, means it was already fixed. Charges past the
dispute window are left out. All open overcharges on one contract form one case,
which grows as new months are billed.

- Total at or above the minimum                 -> Recoverable
- Contract terms need the customer to confirm   -> Needs review
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from recoup.detectors.vendor_keys import vendor_key
from recoup.domain.dates import human_date
from recoup.domain.money import Money
from recoup.domain.sources import Contract
from recoup.domain.types import Evidence, FindingCandidate, LeakType, Outcome, Transaction
from recoup.domain.vendors import VendorDirectory

DETECTOR_VERSION = "pricing/1"
_BP = 10_000


@dataclass(frozen=True, slots=True)
class PricingConfig:
    min_amount_minor: int = 2_500
    dispute_window_days: int = 120


@dataclass(frozen=True, slots=True)
class Overcharge:
    charge: Transaction
    allowed_minor: int

    @property
    def excess_minor(self) -> int:
        return self.charge.amount_minor - self.allowed_minor


def allowed_price(contract: Contract, day: date) -> int | None:
    """The most the contract lets the vendor charge on `day`, or None for no limit."""
    if contract.price_minor is None:
        return None
    if contract.price_locked_until is None or day <= contract.price_locked_until:
        return contract.price_minor
    if contract.price_increase_cap_bp is None:
        return None
    return contract.price_minor * (_BP + contract.price_increase_cap_bp) // _BP


def _monthly_charges(
    transactions: Sequence[Transaction], key: str, vendors: VendorDirectory, as_of: date
) -> list[Transaction]:
    first: dict[date, Transaction] = {}
    for txn in sorted(transactions, key=lambda t: (t.posted_at, t.id)):
        if txn.is_debit and txn.posted_at.date() <= as_of and vendor_key(txn, vendors) == key:
            first.setdefault(txn.posted_at.date().replace(day=1), txn)
    return list(first.values())


def _consume_credit(credits: list[Transaction], overcharge: Overcharge) -> bool:
    """Claim a credit that reverses this overcharge, or the whole charge."""
    charge = overcharge.charge
    for index, credit in enumerate(credits):
        if credit.posted_at < charge.posted_at or credit.currency != charge.currency:
            continue
        if -credit.amount_minor in (overcharge.excess_minor, charge.amount_minor):
            credits.pop(index)
            return True
    return False


def find_overcharges(
    contract: Contract,
    transactions: Sequence[Transaction],
    vendors: VendorDirectory,
    as_of: date,
    config: PricingConfig,
) -> list[Overcharge]:
    credits = sorted(
        (
            t
            for t in transactions
            if not t.is_debit
            and t.posted_at.date() <= as_of
            and vendor_key(t, vendors) == contract.vendor_key
        ),
        key=lambda t: (t.posted_at, t.id),
    )
    window = timedelta(days=config.dispute_window_days)
    found: list[Overcharge] = []
    for charge in _monthly_charges(transactions, contract.vendor_key, vendors, as_of):
        allowed = allowed_price(contract, charge.posted_at.date())
        if allowed is None or charge.currency != contract.price_currency:
            continue
        overcharge = Overcharge(charge, allowed)
        if overcharge.excess_minor <= 0 or _consume_credit(credits, overcharge):
            continue
        if charge.posted_at.date() + window < as_of:
            continue
        found.append(overcharge)
    return found


def _terms(contract: Contract) -> str:
    price = Money(contract.price_minor or 0, contract.price_currency).format()
    if contract.price_locked_until is None:
        return f"{price} for the term"
    terms = f"{price} through {human_date(contract.price_locked_until)}"
    if contract.price_increase_cap_bp is not None:
        terms += f", then at most {contract.price_increase_cap_bp / 100:g}% more"
    return terms


def _reason(vendor_name: str, contract: Contract, overcharges: Sequence[Overcharge]) -> str:
    total = Money(sum(o.excess_minor for o in overcharges), contract.price_currency).format()
    since = human_date(overcharges[0].charge.posted_at)
    charges = "1 charge" if len(overcharges) == 1 else f"{len(overcharges)} charges"
    reason = (
        f"{vendor_name}'s {contract.plan} agreement sets the price at {_terms(contract)}, "
        f"but {charges} since {since} came in higher, {total} over in total."
    )
    if contract.needs_customer_confirmation:
        reason += " A person should confirm these are the terms we signed before we ask."
    return reason


def _finding(
    vendor_name: str,
    contract: Contract,
    overcharges: Sequence[Overcharge],
    config: PricingConfig,
) -> FindingCandidate:
    first = overcharges[0].charge
    total = sum(o.excess_minor for o in overcharges)
    outcome = Outcome.NEEDS_REVIEW if contract.needs_customer_confirmation else Outcome.RECOVERABLE
    charge_evidence = tuple(
        Evidence(
            kind="transaction",
            ref=o.charge.id,
            detail=f"{o.charge.posted_at.date()} charged {o.charge.money.format()}, "
            f"contract allows {Money(o.allowed_minor, o.charge.currency).format()} "
            f"({o.charge.reference or 'no reference'})",
        )
        for o in overcharges
    )
    return FindingCandidate(
        leak_type=LeakType.PRICE_OVERCHARGE,
        outcome=outcome,
        merchant=first.merchant,
        transaction_ids=tuple(o.charge.id for o in overcharges),
        amount_minor=total,
        currency=first.currency,
        reason=_reason(vendor_name, contract, overcharges),
        evidence=(
            Evidence(kind="contract", ref=contract.document, detail=contract.price_clause),
            *charge_evidence,
            Evidence(
                kind="rule",
                ref=DETECTOR_VERSION,
                detail=f"Each month's first charge vs the contracted price ({_terms(contract)}); "
                "no credit for the difference has posted.",
            ),
        ),
        detector_version=DETECTOR_VERSION,
        recover_by=(first.posted_at + timedelta(days=config.dispute_window_days)).date(),
        identity=f"{contract.vendor_key}:{contract.plan}",
    )


def detect_price_overcharges(
    transactions: Sequence[Transaction],
    contracts: Sequence[Contract],
    vendors: VendorDirectory,
    as_of: date,
    config: PricingConfig | None = None,
) -> list[FindingCandidate]:
    config = config or PricingConfig()
    findings: list[FindingCandidate] = []
    for contract in contracts:
        if contract.price_minor is None:
            continue
        overcharges = find_overcharges(contract, transactions, vendors, as_of, config)
        if sum(o.excess_minor for o in overcharges) < config.min_amount_minor:
            continue
        vendor = vendors.for_merchant(contract.vendor_key)
        name = vendor.name if vendor else overcharges[0].charge.merchant
        findings.append(_finding(name, contract, overcharges, config))
    return findings
