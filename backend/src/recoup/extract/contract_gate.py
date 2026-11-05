"""Code-level checks between a model's reading of a contract and a stored `Contract`.

A contract decides how much Recoup asks for, so each term must be traceable to the
document even if the model is fooled by text planted in it:

1. Vendor: the name must resolve in the vendor directory; recipients come from there.
2. Grounding: each clause must appear verbatim in the document text.
3. Numbers: the uptime target and the price must be written in their clause, and each
   tier's numbers and the increase cap must be written in the document. Percents must
   carry a % sign, so a section number cannot pass for a cap.
4. Shape: tiers must step down in uptime and up in credit, within sane ranges.

A term that fails is dropped with a reason; a contract with no surviving term is rejected.
"""

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from itertools import pairwise

from recoup.domain.money import MINOR_UNIT_EXPONENTS, Money
from recoup.domain.sources import Contract, SlaTier, Vendor
from recoup.domain.vendors import VendorDirectory
from recoup.extract.schema import ContractReading
from recoup.extract.validate import MIN_QUOTE_CHARS, _amount_in_quote, _date_written, _decimal

MIN_UPTIME_PCT = Decimal(90)
MAX_CLAIM_WINDOW_DAYS = 365
DEFAULT_CLAIM_WINDOW_DAYS = 30
_EARLIEST_LOCK = date(2000, 1, 1)
_LATEST_LOCK = date(2100, 1, 1)
_SPACE = re.compile(r"\s+")
_KEY = re.compile(r"[^a-z0-9]+")
_PERCENT = re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)\s?%")


@dataclass(frozen=True, slots=True)
class ContractVerdict:
    contract: Contract | None
    problems: tuple[str, ...]


def _squash(text: str) -> str:
    return _SPACE.sub(" ", text).strip()


def _grounded(clause: str | None, text: str) -> str | None:
    """The clause, squashed, if it is long enough and appears in the document."""
    if not clause:
        return None
    squashed = _squash(clause)
    return squashed if len(squashed) >= MIN_QUOTE_CHARS and squashed in text else None


def _percent_written(pct: str, text: str) -> bool:
    """The percent appears with its % sign: "7" matches "7%" but not "Section 7"."""
    wanted = _decimal(pct)
    return wanted is not None and any(_decimal(n) == wanted for n in _PERCENT.findall(text))


def _basis_points(pct: str) -> int | None:
    """Percent to basis points, only when exact: '99.95' -> 9995, '99.995' -> None."""
    value = _decimal(pct)
    if value is None:
        return None
    bp = value * 100
    return int(bp) if bp == bp.to_integral_value() else None


def _resolve_vendor(name: str, vendors: VendorDirectory) -> Vendor | None:
    """An exact name, key, or alias; else the one longest name the legal name starts with,
    so "Linear Orbit, Inc." is Linear but "Amazon" alone never picks between Amazons."""
    wanted = _KEY.sub("", name.lower())
    if not wanted:
        return None
    names = [(v, _KEY.sub("", n.lower())) for v in vendors for n in (v.name, v.key, *v.aliases)]
    exact = {v.key: v for v, n in names if n == wanted}
    if exact:
        return next(iter(exact.values())) if len(exact) == 1 else None
    prefixes = [(len(n), v) for v, n in names if n and wanted.startswith(n)]
    if not prefixes:
        return None
    longest = max(length for length, _ in prefixes)
    best = {v.key: v for length, v in prefixes if length == longest}
    return next(iter(best.values())) if len(best) == 1 else None


def _tiers(reading: ContractReading, target_bp: int, text: str) -> tuple[SlaTier, ...] | str:
    found: list[SlaTier] = []
    for item in reading.credit_tiers:
        below = _basis_points(item.below_uptime_pct)
        if below is None or not _percent_written(item.below_uptime_pct, text):
            return f"tier uptime {item.below_uptime_pct!r} is not written in the document"
        if not _percent_written(str(item.credit_pct), text):
            return f"tier credit {item.credit_pct}% is not written in the document"
        found.append(SlaTier(below_bp=below, credit_pct=item.credit_pct))
    tiers = sorted(found, key=lambda t: -t.below_bp)
    if any(t.below_bp > target_bp or not 0 < t.credit_pct <= 100 for t in tiers):
        return "a credit tier is above the uptime target or outside 1-100%"
    if any(a.below_bp == b.below_bp or a.credit_pct >= b.credit_pct for a, b in pairwise(tiers)):
        return "credit tiers must grow as uptime falls"
    return tuple(tiers)


def _sla_terms(reading: ContractReading, text: str) -> tuple[dict[str, object], list[str]]:
    if reading.uptime_commitment_pct is None:
        return {}, []
    clause = _grounded(reading.sla_clause, text)
    if clause is None:
        return {}, ["dropped the SLA: its clause is not in the document"]
    target = _basis_points(reading.uptime_commitment_pct)
    if target is None or not _percent_written(reading.uptime_commitment_pct, clause):
        return {}, ["dropped the SLA: the uptime target is not written in its clause"]
    if not MIN_UPTIME_PCT * 100 <= target < 10_000:
        return {}, [f"dropped the SLA: {reading.uptime_commitment_pct}% is not a plausible target"]
    tiers = _tiers(reading, target, text)
    if isinstance(tiers, str):
        return {}, [f"dropped the SLA: {tiers}"]
    if not tiers:
        return {}, ["dropped the SLA: it states no service credits"]
    problems: list[str] = []
    window = reading.claim_window_days
    if window is None or not 0 < window <= MAX_CLAIM_WINDOW_DAYS:
        problems.append(f"claim window not stated; assumed {DEFAULT_CLAIM_WINDOW_DAYS} days")
        window = DEFAULT_CLAIM_WINDOW_DAYS
    lowered = text.lower()
    components = tuple(c for c in reading.covered_components if c and c.lower() in lowered)
    if len(components) < len(reading.covered_components):
        problems.append("dropped covered components that are not named in the document")
    terms = {
        "sla_target_bp": target,
        "tiers": tiers,
        "claim_window_days": window,
        "clause": clause,
        "period": reading.measurement_period or "month",
        "covered_components": components,
    }
    return terms, problems


def _lock_date(reading: ContractReading, text: str) -> date | None:
    if not reading.price_locked_until:
        return None
    try:
        day = date.fromisoformat(reading.price_locked_until)
    except ValueError:
        return None
    is_plausible = _EARLIEST_LOCK <= day < _LATEST_LOCK
    return day if is_plausible and _date_written(day, text) else None


def _price_terms(reading: ContractReading, text: str) -> tuple[dict[str, object], list[str]]:
    if reading.price_per_period is None:
        return {}, []
    clause = _grounded(reading.price_clause, text)
    if clause is None:
        return {}, ["dropped the price: its clause is not in the document"]
    currency = (reading.price_currency or "USD").upper()
    if currency not in MINOR_UNIT_EXPONENTS:
        return {}, [f"dropped the price: unsupported currency {currency!r}"]
    if not _amount_in_quote(reading.price_per_period, clause):
        return {}, ["dropped the price: the amount is not written in its clause"]
    try:
        price = Money.parse(reading.price_per_period, currency).amount_minor
    except ValueError:
        return {}, ["dropped the price: the amount does not parse"]
    if price <= 0:
        return {}, ["dropped the price: it is not positive"]
    problems: list[str] = []
    locked = _lock_date(reading, text)
    if reading.price_locked_until and locked is None:
        problems.append("dropped the price lock: its date is not written in the document")
    cap = None
    if reading.price_increase_cap_pct is not None:
        cap = _basis_points(reading.price_increase_cap_pct)
        is_written = _percent_written(reading.price_increase_cap_pct, text)
        if cap is None or not 0 <= cap <= 10_000 or not is_written:
            problems.append("dropped the increase cap: it is not a percent written in the document")
            cap = None
    terms = {
        "price_minor": price,
        "price_currency": currency,
        "price_locked_until": locked,
        "price_increase_cap_bp": cap,
        "price_clause": clause,
    }
    return terms, problems


def validate_contract(
    reading: ContractReading, text: str, vendors: VendorDirectory, document: str
) -> ContractVerdict:
    """The contract this document supports, or None and why not."""
    vendor = _resolve_vendor(reading.vendor_name, vendors)
    if vendor is None:
        return ContractVerdict(None, (f"{reading.vendor_name!r} is not in the vendor directory",))
    plan = _squash(reading.plan)
    if not plan:
        return ContractVerdict(None, ("the document names no plan",))
    squashed = _squash(text)
    sla, sla_problems = _sla_terms(reading, squashed)
    price, price_problems = _price_terms(reading, squashed)
    problems = (*sla_problems, *price_problems)
    if not sla and not price:
        return ContractVerdict(None, (*problems, "no SLA or price term survived the checks"))
    contract = Contract.model_validate(
        {"vendor_key": vendor.key, "plan": plan, "document": document, **sla, **price}
    )
    return ContractVerdict(contract, problems)
